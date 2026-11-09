import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { precioConIva } from '../../common/dominio/montos.js';
import { TIPOS_ENTREGA } from '../../common/dominio/valores.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { armarBulto, MEDIDAS, unidades } from './bulto.js';
import { CODIGOS_CHILEXPRESS } from './codigos-chilexpress.js';
import {
  CreadorOrdenTransporte,
  ErrorCreacionOt,
  type OtCreada,
} from './orden-transporte.js';

/** Se agrega a cada rechazo: el personal puede seguir como antes de SCRUM-153. */
const RESPALDO =
  'Puedes crear la OT en el portal de Chilexpress y escribir su número al despachar.';
const conRespaldo = (motivo: string) => `${motivo} ${RESPALDO}`;

export const SIN_BODEGA_DESPACHO = conRespaldo(
  'No hay una bodega de despacho activa: márcala en Inventario › Bodegas.',
);
export const OT_NO_CONFIGURADA = conRespaldo(
  'La creación automática de la OT no está configurada.',
);

/**
 * Crea la OT de Chilexpress de un pedido con despacho (SCRUM-153), fuera de cualquier transacción:
 * es una llamada externa. Origen y devolución: la bodega de despacho. Destino y contacto: los que
 * el pedido guardó al crearse. Bulto: el mismo con que se cotizó. Si algo falta o Chilexpress
 * falla, responde con un mensaje que ofrece escribir el número a mano.
 */
@Injectable()
export class GenerarOtService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creador: CreadorOrdenTransporte,
  ) {}

  /** Si la OT se puede crear sola; si no, el personal escribe el número (como antes). */
  get configurado(): boolean {
    return this.creador.configurado;
  }

  async generar(codigoPedido: string): Promise<OtCreada> {
    if (!this.creador.configurado) {
      throw new ServiceUnavailableException(OT_NO_CONFIGURADA);
    }
    const pedido = await this.prisma.pedido.findUnique({
      where: { codigoPublico: codigoPedido },
      select: {
        tipoEntrega: true,
        montoTotal: true,
        porcentajeIva: true,
        usuario: { select: { email: true, telefono: true } },
        detalles: {
          select: {
            cantidad: true,
            articulo: {
              select: {
                formato: { select: MEDIDAS },
                pack: {
                  select: {
                    componentes: {
                      select: { cantidad: true, formato: { select: MEDIDAS } },
                    },
                  },
                },
              },
            },
          },
        },
        envio: {
          select: {
            destinatario: true,
            telefonoContacto: true,
            calle: true,
            numero: true,
            referencia: true,
            codigoServicio: true,
            costoNeto: true,
            comuna: { select: { codigoCut: true } },
          },
        },
      },
    });
    if (!pedido) throw new NotFoundException('El pedido no existe.');
    const envio = pedido.envio;
    if (pedido.tipoEntrega !== TIPOS_ENTREGA.DESPACHO || !envio) {
      throw new ConflictException('El pedido no tiene despacho a domicilio.');
    }

    const bodega = await this.prisma.bodega.findFirst({
      where: { esDespacho: true, activa: true },
      select: { direccion: true, comuna: { select: { codigoCut: true } } },
    });
    if (!bodega) throw new ConflictException(SIN_BODEGA_DESPACHO);
    const origen = CODIGOS_CHILEXPRESS[bodega.comuna.codigoCut];
    const destino = CODIGOS_CHILEXPRESS[envio.comuna.codigoCut];
    if (!origen || !destino) {
      throw new ConflictException(
        conRespaldo(
          'Chilexpress no tiene cobertura para la comuna de origen o de destino.',
        ),
      );
    }
    if (envio.codigoServicio === null) {
      throw new ConflictException(
        conRespaldo(
          'El pedido no guardó el servicio de Chilexpress que se cotizó.',
        ),
      );
    }
    const telefono = envio.telefonoContacto ?? pedido.usuario.telefono;
    if (!telefono) {
      throw new ConflictException(
        conRespaldo(
          'Chilexpress pide el teléfono del destinatario y el pedido no lo tiene.',
        ),
      );
    }
    const bulto = armarBulto(
      pedido.detalles.flatMap(({ cantidad, articulo }) =>
        articulo.formato
          ? [unidades(articulo.formato, cantidad)]
          : (articulo.pack?.componentes ?? []).map((c) =>
              unidades(c.formato, c.cantidad * cantidad),
            ),
      ),
    );
    if (!bulto) throw new ConflictException('El pedido no tiene productos.');

    try {
      return await this.creador.crear({
        origen,
        destino: {
          cobertura: destino,
          calle: envio.calle,
          numero: envio.numero,
          complemento: envio.referencia,
        },
        devolucion: {
          cobertura: origen,
          calle: bodega.direccion,
          numero: null,
          complemento: null,
        },
        destinatario: {
          nombre: envio.destinatario,
          telefono,
          correo: pedido.usuario.email,
        },
        bulto,
        codigoServicio: envio.codigoServicio,
        referencia: codigoPedido,
        // Los productos, con IVA: el total sin el despacho
        valorDeclarado:
          pedido.montoTotal -
          precioConIva(Number(envio.costoNeto), Number(pedido.porcentajeIva)),
      });
    } catch (error) {
      if (error instanceof ErrorCreacionOt) {
        throw new ServiceUnavailableException(conRespaldo(error.message));
      }
      throw error;
    }
  }
}
