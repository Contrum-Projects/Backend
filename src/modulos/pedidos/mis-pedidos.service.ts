import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { urlPublicaArchivo } from '../../almacen/almacen-archivos.js';
import { precioConIva } from '../../common/dominio/montos.js';
import { pagarHastaDe } from '../../common/dominio/plazo-pago.js';
import {
  ESTADOS_PEDIDO,
  type TIPOS_ARTICULO,
  type TIPOS_DOCUMENTO,
  type TIPOS_ENTREGA,
  type Valor,
} from '../../common/dominio/valores.js';
import {
  POR_PAGINA,
  type Paginacion,
} from '../../common/validacion/paginacion.js';
import type { Entorno } from '../../config/entorno.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { IMAGEN_PRINCIPAL } from '../catalogo/tienda.service.js';
import { PEDIDO_NO_EXISTE } from './codigo-pedido.pipe.js';

/** Un pedido en el historial de la cuenta (E8-H1). */
export interface ResumenPedido {
  codigoPublico: string;
  fechaPedido: Date;
  /** Total con IVA, en pesos. */
  total: number;
  estado: string;
}

export interface HistorialPedidos {
  items: ResumenPedido[];
  total: number;
  pagina: number;
  limite: number;
}

export interface LineaPedido {
  articuloId: number;
  tipo: Valor<typeof TIPOS_ARTICULO>;
  nombre: string;
  nombreFormato: string | null;
  imagen: string | null;
  cantidad: number;
  /** Precio unitario con IVA que se cobró, según el IVA del pedido. */
  precioUnitario: number;
  subtotal: number;
}

export interface EnvioPedido {
  servicio: string;
  /** Costo del envío con IVA, en pesos. */
  costo: number;
  estado: string;
  codigoSeguimiento: string | null;
  /** Fecha estimada de entrega, `AAAA-MM-DD`. */
  fechaEstimada: string | null;
  destinatario: string;
  telefonoContacto: string | null;
  calle: string;
  numero: string;
  referencia: string | null;
  comuna: { codigoCut: string; nombre: string };
}

export interface CambioEstadoPedido {
  estado: string;
  fecha: Date;
}

/** El pedido completo que ve su dueño (E8-H1). */
export interface DetallePedidoCuenta {
  codigoPublico: string;
  fechaPedido: Date;
  estado: string;
  /** Hasta cuándo se puede pagar; solo mientras el pedido espera el pago. */
  pagarHasta: Date | null;
  tipoEntrega: Valor<typeof TIPOS_ENTREGA>;
  tipoDocumento: Valor<typeof TIPOS_DOCUMENTO>;
  porcentajeIva: number;
  montos: { neto: number; iva: number; total: number };
  items: LineaPedido[];
  /** `null` si el pedido es para retiro en tienda. */
  envio: EnvioPedido | null;
  /** Cambios de estado, del primero al último. */
  historial: CambioEstadoPedido[];
}

/**
 * Pedidos de la cuenta con sesión (E8-H1, RF-08.01): solo lectura y siempre de la cuenta del
 * token. Un pedido de otra cuenta responde igual que uno que no existe.
 */
@Injectable()
export class MisPedidosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
  ) {}

  /** E8-H1 · Historial: los pedidos de la cuenta, del más reciente al más antiguo. */
  async listar(
    codigoPublico: string,
    paginacion: Paginacion,
  ): Promise<HistorialPedidos> {
    const pagina = paginacion.pagina ?? 1;
    const limite = paginacion.limite ?? POR_PAGINA;
    const where = { usuario: { codigoPublico } };

    const [total, filas] = await Promise.all([
      this.prisma.pedido.count({ where }),
      this.prisma.pedido.findMany({
        where,
        select: {
          codigoPublico: true,
          fechaPedido: true,
          estadoActual: true,
          montoTotal: true,
        },
        orderBy: [{ fechaPedido: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * limite,
        take: limite,
      }),
    ]);

    return {
      items: filas.map((fila) => ({
        codigoPublico: fila.codigoPublico,
        fechaPedido: fila.fechaPedido,
        total: fila.montoTotal,
        estado: fila.estadoActual,
      })),
      total,
      pagina,
      limite,
    };
  }

  /**
   * E8-H1 · Detalle de un pedido de la cuenta: artículos con su precio, montos, entrega y
   * cambios de estado. De los cambios solo se muestran estado y fecha: el comentario y quién lo
   * hizo son del personal.
   */
  async obtener(
    codigoPublico: string,
    codigoPedido: string,
  ): Promise<DetallePedidoCuenta> {
    const pedido = await this.prisma.pedido.findFirst({
      where: { codigoPublico: codigoPedido, usuario: { codigoPublico } },
      select: {
        codigoPublico: true,
        fechaPedido: true,
        fechaExpiracionPago: true,
        estadoActual: true,
        tipoEntrega: true,
        tipoDocumentoSolicitado: true,
        porcentajeIva: true,
        montoNeto: true,
        montoIva: true,
        montoTotal: true,
        detalles: {
          select: {
            articuloId: true,
            cantidad: true,
            precioUnitarioNetoAplicado: true,
            articulo: {
              select: {
                tipo: true,
                imagenes: IMAGEN_PRINCIPAL,
                formato: {
                  select: {
                    nombreFormato: true,
                    producto: { select: { nombre: true } },
                  },
                },
                pack: { select: { nombre: true } },
              },
            },
          },
          orderBy: { articuloId: 'asc' },
        },
        envio: {
          select: {
            servicioEnvio: true,
            costoNeto: true,
            estadoEnvio: true,
            codigoSeguimiento: true,
            fechaEstimada: true,
            destinatario: true,
            telefonoContacto: true,
            calle: true,
            numero: true,
            referencia: true,
            comuna: { select: { codigoCut: true, nombre: true } },
          },
        },
        historial: {
          select: { estado: true, fechaHora: true },
          orderBy: { correlativo: 'asc' },
        },
      },
    });
    if (!pedido) throw new NotFoundException(PEDIDO_NO_EXISTE);

    const iva = Number(pedido.porcentajeIva);
    const urlBase = this.config.get('R2_URL_PUBLICA', { infer: true });

    return {
      codigoPublico: pedido.codigoPublico,
      fechaPedido: pedido.fechaPedido,
      estado: pedido.estadoActual,
      pagarHasta:
        pedido.estadoActual === ESTADOS_PEDIDO.PENDIENTE_PAGO
          ? pagarHastaDe(pedido.fechaExpiracionPago)
          : null,
      tipoEntrega: pedido.tipoEntrega as DetallePedidoCuenta['tipoEntrega'],
      tipoDocumento:
        pedido.tipoDocumentoSolicitado as DetallePedidoCuenta['tipoDocumento'],
      porcentajeIva: iva,
      montos: {
        neto: pedido.montoNeto,
        iva: pedido.montoIva,
        total: pedido.montoTotal,
      },
      items: pedido.detalles.map((detalle) => {
        const { articulo } = detalle;
        const clave = articulo.imagenes[0]?.ubicacionArchivo;
        const precioUnitario = precioConIva(
          Number(detalle.precioUnitarioNetoAplicado),
          iva,
        );
        return {
          articuloId: detalle.articuloId,
          tipo: articulo.tipo as LineaPedido['tipo'],
          nombre:
            articulo.formato?.producto.nombre ?? articulo.pack?.nombre ?? '',
          nombreFormato: articulo.formato?.nombreFormato ?? null,
          imagen: clave ? urlPublicaArchivo(urlBase, clave) : null,
          cantidad: detalle.cantidad,
          precioUnitario,
          subtotal: precioUnitario * detalle.cantidad,
        };
      }),
      envio: pedido.envio
        ? {
            servicio: pedido.envio.servicioEnvio,
            costo: precioConIva(Number(pedido.envio.costoNeto), iva),
            estado: pedido.envio.estadoEnvio,
            codigoSeguimiento: pedido.envio.codigoSeguimiento,
            fechaEstimada:
              pedido.envio.fechaEstimada?.toISOString().slice(0, 10) ?? null,
            destinatario: pedido.envio.destinatario,
            telefonoContacto: pedido.envio.telefonoContacto,
            calle: pedido.envio.calle,
            numero: pedido.envio.numero,
            referencia: pedido.envio.referencia,
            comuna: pedido.envio.comuna,
          }
        : null,
      historial: pedido.historial.map((cambio) => ({
        estado: cambio.estado,
        fecha: cambio.fechaHora,
      })),
    };
  }
}
