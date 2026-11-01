import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { netoDesdeConIva, precioConIva } from '../../common/dominio/montos.js';
import type { Rol } from '../../common/dominio/roles.js';
import type { Entorno } from '../../config/entorno.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS } from '../../redis/redis.module.js';
import { CarritoService } from '../carrito/carrito.service.js';
import { armarBulto, type UnidadesBulto } from './bulto.js';
import { COTIZACION_NO_DISPONIBLE } from './cotizador-chilexpress.js';
import {
  type Bulto,
  CotizadorEnvio,
  type TarifaEnvio,
} from './cotizador-envio.js';
import type { CotizarDespachoDto } from './dto/cotizar-despacho.dto.js';

export const SIN_COBERTURA =
  'Chilexpress no tiene despacho disponible para esta dirección y este pedido. Puedes elegir retiro en tienda.';
export const CARRITO_SIN_ARTICULOS = 'El carrito está vacío.';
export const ARTICULO_NO_VENDIBLE =
  'Tu carrito tiene un artículo que ya no está a la venta: quítalo para cotizar el despacho.';

/** E7: la misma cotización se repite sin volver a consultar al courier durante 15 minutos. */
const VIGENCIA_CACHE_SEGUNDOS = 15 * 60;

type Cliente = Prisma.TransactionClient | PrismaService;

const MEDIDAS = {
  pesoGramos: true,
  altoCm: true,
  anchoCm: true,
  largoCm: true,
} satisfies Prisma.FormatoProductoSelect;

type Medidas = Prisma.FormatoProductoGetPayload<{
  select: typeof MEDIDAS;
}>;

const unidades = (medidas: Medidas, cantidad: number): UnidadesBulto => ({
  pesoGramos: medidas.pesoGramos,
  altoCm: Number(medidas.altoCm),
  anchoCm: Number(medidas.anchoCm),
  largoCm: Number(medidas.largoCm),
  cantidad,
});

/** Lo que cuesta despachar: se guarda neto y el cliente lo paga con IVA (RNF-11). */
export interface EnvioCotizado {
  servicio: string;
  costoNeto: number;
}

/** E7-H2 · Lo que ve el cliente antes de pagar. No informa el servicio: se cobra el más barato. */
export interface CotizacionDespacho {
  /** Costo del despacho con IVA, en pesos. */
  costo: number;
  /** Total del carrito con IVA, sin el despacho. */
  totalCarrito: number;
  /** Lo que pagaría: carrito más despacho. */
  total: number;
}

@Injectable()
export class CotizarEnvioService {
  private readonly logger = new Logger(CotizarEnvioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly cotizador: CotizadorEnvio,
    private readonly carrito: CarritoService,
  ) {}

  /** E7-H2 · Costo del despacho del carrito a una dirección de la cuenta, antes de pedir. */
  async cotizarCarrito(
    codigoPublico: string,
    rol: Rol,
    { direccionId }: CotizarDespachoDto,
  ): Promise<CotizacionDespacho> {
    const { id: usuarioId } = await this.prisma.usuario.findUniqueOrThrow({
      where: { codigoPublico },
      select: { id: true },
    });
    const direccion = await this.prisma.direccion.findFirst({
      where: { id: direccionId, usuarioId },
      select: { comuna: { select: { codigoCut: true } } },
    });
    if (!direccion) throw new NotFoundException('La dirección no existe.');

    const bulto = await this.bultoDelCarrito(this.prisma, usuarioId);
    if (!bulto) throw new ConflictException(CARRITO_SIN_ARTICULOS);

    const { items, total: totalCarrito } = await this.carrito.obtener(
      codigoPublico,
      rol,
    );
    // Como al crear el pedido: el costo no puede incluir lo que ya no se vende
    if (items.some((item) => !item.aLaVenta)) {
      throw new ConflictException(ARTICULO_NO_VENDIBLE);
    }

    const envio = await this.cotizar(direccion.comuna.codigoCut, bulto);
    const porcentajeIva = this.config.get('IVA_PORCENTAJE', { infer: true });
    const costo = precioConIva(envio.costoNeto, porcentajeIva);
    return { costo, totalCarrito, total: totalCarrito + costo };
  }

  /** El bulto de lo que hay en el carrito de la cuenta; `null` si está vacío. Un pack va por sus formatos. */
  async bultoDelCarrito(
    cliente: Cliente,
    usuarioId: number,
  ): Promise<Bulto | null> {
    const carrito = await cliente.carrito.findUnique({
      where: { usuarioId },
      select: {
        items: {
          select: {
            cantidad: true,
            articulo: {
              select: {
                formato: { select: MEDIDAS },
                pack: {
                  select: {
                    componentes: {
                      select: {
                        cantidad: true,
                        formato: { select: MEDIDAS },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    return armarBulto(
      (carrito?.items ?? []).flatMap(({ cantidad, articulo }) =>
        articulo.formato
          ? [unidades(articulo.formato, cantidad)]
          : (articulo.pack?.componentes ?? []).map((componente) =>
              unidades(componente.formato, componente.cantidad * cantidad),
            ),
      ),
    );
  }

  /**
   * E7-H2 · Cotiza desde la bodega de la venta online hasta la comuna (RF-07.02). 409 sin cobertura y
   * 503 si el courier no responde: en ambos casos el cliente puede elegir retiro. Nunca dentro de una
   * transacción: es una llamada externa.
   */
  async cotizar(destinoCut: string, bulto: Bulto): Promise<EnvioCotizado> {
    const origenCut = await this.comunaDeOrigen();
    const clave = `cache:cotizacion-envio:${origenCut}:${destinoCut}:${bulto.pesoGramos}:${bulto.altoCm}x${bulto.anchoCm}x${bulto.largoCm}`;
    const tarifa =
      (await this.leerCache(clave)) ??
      (await this.consultar(clave, { origenCut, destinoCut, bulto }));
    if (!tarifa) throw new ConflictException(SIN_COBERTURA);
    return {
      servicio: tarifa.servicio,
      costoNeto: netoDesdeConIva(
        tarifa.tarifa,
        this.config.get('IVA_PORCENTAJE', { infer: true }),
      ),
    };
  }

  /** La bodega central: la primera que sigue activa y abastece la venta online. */
  private async comunaDeOrigen(): Promise<string> {
    const bodega = await this.prisma.bodega.findFirst({
      where: { activa: true, abasteceVentaOnline: true },
      orderBy: { id: 'asc' },
      select: { comuna: { select: { codigoCut: true } } },
    });
    if (!bodega) {
      this.logger.error('No hay bodega activa que abastezca la venta online.');
      throw new ServiceUnavailableException(COTIZACION_NO_DISPONIBLE);
    }
    return bodega.comuna.codigoCut;
  }

  private async consultar(
    clave: string,
    solicitud: Parameters<CotizadorEnvio['cotizar']>[0],
  ): Promise<TarifaEnvio | null> {
    const tarifa = await this.cotizador.cotizar(solicitud);
    if (tarifa) await this.guardarCache(clave, tarifa);
    return tarifa;
  }

  /** Si Redis no responde, se consulta directo al courier (RNF-32). */
  private async leerCache(clave: string): Promise<TarifaEnvio | null> {
    try {
      const guardado = await this.redis.get(clave);
      if (guardado === null) return null;
      const tarifa = JSON.parse(guardado) as Partial<TarifaEnvio>;
      // Una copia inválida no llega al total del pedido: se vuelve a consultar al courier
      return tarifa.servicio &&
        Number.isInteger(tarifa.tarifa) &&
        tarifa.tarifa! > 0
        ? (tarifa as TarifaEnvio)
        : null;
    } catch (error) {
      this.advertir('leer', error);
      return null;
    }
  }

  private async guardarCache(
    clave: string,
    tarifa: TarifaEnvio,
  ): Promise<void> {
    try {
      await this.redis.set(
        clave,
        JSON.stringify(tarifa),
        'EX',
        VIGENCIA_CACHE_SEGUNDOS,
      );
    } catch (error) {
      this.advertir('guardar', error);
    }
  }

  private advertir(accion: string, error: unknown) {
    this.logger.warn(
      `No se pudo ${accion} la cotización en Redis: ${(error as Error).message}`,
    );
  }
}
