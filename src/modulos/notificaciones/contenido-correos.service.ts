import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TRABAJOS_CORREO,
  type TrabajoCambioEstadoPedido,
  type TrabajoConfirmacionSuscripcion,
  type TrabajoCorreo,
  type TrabajoCorreoConEnlace,
  type TrabajoPagoConfirmado,
  type TrabajoRecordatorioCarrito,
  type TrabajoRolProfesionalRetirado,
  type TrabajoStockBajo,
  type TrabajoVerificacionAprobada,
} from '../../colas/colas.js';
import { precioConIva } from '../../common/dominio/montos.js';
import { type Rol, ROLES } from '../../common/dominio/roles.js';
import {
  ESTADOS_PEDIDO,
  TIPOS_ENTREGA,
  TIPOS_MOVIMIENTO,
} from '../../common/dominio/valores.js';
import type { Entorno } from '../../config/entorno.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CarritoService } from '../carrito/carrito.service.js';
import { FirmaBaja } from '../marketing/firma-baja.js';
import {
  type CorreoRenderizado,
  fechaConHora,
  fechaCorta,
  type FilaDato,
  formatearPesos,
  type PasoPedido,
  rutasTienda,
} from './plantillas/base.js';
import {
  correoConfirmacion,
  correoInvitacion,
  correoRecuperacion,
  correoRolProfesionalRetirado,
  correoVerificacionAprobada,
} from './plantillas/cuenta.js';
import {
  correoCambioEstado,
  correoPagoConfirmado,
} from './plantillas/pedido.js';
import {
  correoStockBajo,
  correoStockBajoRecuperado,
} from './plantillas/stock-bajo.js';
import { correoRecordatorioCarrito } from './plantillas/carrito.js';
import { correoConfirmacionSuscripcion } from './plantillas/suscripcion.js';

export interface NotificacionACorreo {
  asunto: string;
  pedidoId: number | null;
  /** La cuenta a la que va: el motivo del cambio de rol se lee de su historial (E13-H3). */
  usuarioId?: number | null;
}

const PASOS_DESPACHO: [string, string][] = [
  [ESTADOS_PEDIDO.PAGADO, 'Pagado'],
  [ESTADOS_PEDIDO.EN_PREPARACION, 'En preparación'],
  [ESTADOS_PEDIDO.DESPACHADO, 'Despachado'],
  [ESTADOS_PEDIDO.ENTREGADO, 'Entregado'],
];

const PASOS_RETIRO: [string, string][] = [
  [ESTADOS_PEDIDO.PAGADO, 'Pagado'],
  [ESTADOS_PEDIDO.EN_PREPARACION, 'En preparación'],
  [ESTADOS_PEDIDO.LISTO_PARA_RETIRO, 'Listo para retiro'],
  [ESTADOS_PEDIDO.RETIRADO, 'Retirado'],
];

/** Movimientos que bajan el stock de un formato: los únicos que hacen cruzar el mínimo. */
const MOVIMIENTOS_QUE_DESCUENTAN: Record<string, string> = {
  [TIPOS_MOVIMIENTO.VENTA]: 'Venta',
  [TIPOS_MOVIMIENTO.MERMA_VENCIMIENTO]: 'Merma por vencimiento',
  [TIPOS_MOVIMIENTO.MERMA_DANO]: 'Merma por daño',
  [TIPOS_MOVIMIENTO.CONSUMO_PELUQUERIA]: 'Consumo de peluquería',
  [TIPOS_MOVIMIENTO.AJUSTE_NEGATIVO]: 'Ajuste de inventario',
};

const direccionDe = (envio: {
  calle: string;
  numero: string;
  referencia: string | null;
  comuna: { nombre: string };
}): string =>
  [`${envio.calle} ${envio.numero}`, envio.referencia, envio.comuna.nombre]
    .filter(Boolean)
    .join(', ');

/**
 * Arma el correo de cada trabajo con su plantilla. Los datos del pedido y del stock se leen de la
 * base al enviar: así un correo reencolado tras una caída de Redis sale igual de completo (RNF-29).
 */
@Injectable()
export class ContenidoCorreosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
    private readonly firmaBaja: FirmaBaja,
    private readonly carritoService: CarritoService,
  ) {}

  construir(
    trabajo: string,
    datos: TrabajoCorreo,
    notificacion: NotificacionACorreo,
  ): Promise<CorreoRenderizado> | CorreoRenderizado {
    switch (trabajo) {
      case TRABAJOS_CORREO.CONFIRMACION_CORREO:
      case TRABAJOS_CORREO.RECUPERACION_CONTRASENA:
      case TRABAJOS_CORREO.INVITACION_PERSONAL:
        return this.correoDeCuenta(
          trabajo,
          datos as TrabajoCorreoConEnlace,
          notificacion.asunto,
        );
      case TRABAJOS_CORREO.CONFIRMACION_SUSCRIPCION: {
        const { destinatario, enlace } =
          datos as TrabajoConfirmacionSuscripcion;
        return correoConfirmacionSuscripcion({
          asunto: notificacion.asunto,
          destinatario,
          enlace,
          horas: this.config.get('CONFIRMACION_CORREO_HORAS', {
            infer: true,
          }),
          enlacesPie: this.rutas.pie,
        });
      }
      case TRABAJOS_CORREO.PAGO_CONFIRMADO:
        return this.pagoConfirmado(
          (datos as TrabajoPagoConfirmado).nombre,
          notificacion,
        );
      case TRABAJOS_CORREO.CAMBIO_ESTADO_PEDIDO:
        return this.cambioEstado(
          datos as TrabajoCambioEstadoPedido,
          notificacion,
        );
      case TRABAJOS_CORREO.STOCK_BAJO:
        return this.stockBajo(datos, notificacion.asunto);
      case TRABAJOS_CORREO.VERIFICACION_APROBADA:
        return correoVerificacionAprobada({
          asunto: notificacion.asunto,
          nombre: (datos as TrabajoVerificacionAprobada).nombre,
          urlCatalogo: this.rutas.catalogo,
          enlacesPie: this.rutas.pie,
        });
      case TRABAJOS_CORREO.ROL_PROFESIONAL_RETIRADO:
        return this.rolProfesionalRetirado(
          datos as TrabajoRolProfesionalRetirado,
          notificacion,
        );
      case TRABAJOS_CORREO.RECORDATORIO_CARRITO:
        return this.recordatorioCarrito(
          datos as TrabajoRecordatorioCarrito,
          notificacion,
        );
      default:
        throw new Error(`Trabajo de correo desconocido: ${trabajo}`);
    }
  }

  private get rutas() {
    return rutasTienda(this.config.get('URL_TIENDA', { infer: true }));
  }

  private correoDeCuenta(
    trabajo: string,
    { nombre, destinatario, enlace }: TrabajoCorreoConEnlace,
    asunto: string,
  ): CorreoRenderizado {
    const enlacesPie = this.rutas.pie;
    if (trabajo === TRABAJOS_CORREO.CONFIRMACION_CORREO) {
      return correoConfirmacion({
        asunto,
        destinatario,
        enlace,
        enlacesPie,
      });
    }
    if (trabajo === TRABAJOS_CORREO.RECUPERACION_CONTRASENA) {
      return correoRecuperacion({
        asunto,
        enlace,
        horas: this.config.get('RECUPERACION_CONTRASENA_HORAS', {
          infer: true,
        }),
        enlacesPie,
      });
    }
    return correoInvitacion({
      asunto,
      nombre,
      enlace,
      horas: this.config.get('INVITACION_PERSONAL_HORAS', { infer: true }),
      enlacesPie,
    });
  }

  /**
   * E13-H3 · El motivo es el del último paso de profesional a cliente de esa cuenta: se lee al
   * enviar, así un correo reencolado lo lleva igual y el texto no queda en Redis.
   */
  private async rolProfesionalRetirado(
    { nombre }: TrabajoRolProfesionalRetirado,
    { asunto, usuarioId }: NotificacionACorreo,
  ): Promise<CorreoRenderizado> {
    const cambio = await this.prisma.historialRol.findFirstOrThrow({
      where: {
        usuarioId: usuarioId ?? -1,
        rolAnterior: ROLES.PROFESIONAL,
        rolNuevo: ROLES.CLIENTE,
      },
      select: { motivo: true },
      orderBy: { id: 'desc' },
    });
    return correoRolProfesionalRetirado({
      asunto,
      nombre,
      motivo: cambio.motivo ?? '',
      urlCatalogo: this.rutas.catalogo,
      enlacesPie: this.rutas.pie,
    });
  }

  /**
   * E12-H4 · Los artículos se leen del carrito al enviar, sin precios: así un correo reencolado
   * muestra el carrito de ese momento (RNF-29). El enlace de baja va firmado y no vence (RNF-26).
   */
  private async recordatorioCarrito(
    { nombre, destinatario }: TrabajoRecordatorioCarrito,
    { asunto, usuarioId }: NotificacionACorreo,
  ): Promise<CorreoRenderizado> {
    const carrito = await this.prisma.carrito.findUnique({
      where: { usuarioId: usuarioId ?? -1 },
      select: { usuario: { select: { rol: true } } },
    });
    const todos = await this.prisma.itemCarrito.findMany({
      where: { carrito: { usuarioId: usuarioId ?? -1 } },
      select: {
        articuloId: true,
        cantidad: true,
        articulo: {
          select: {
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
      orderBy: [{ fechaAgregado: 'asc' }, { articuloId: 'asc' }],
    });
    // Solo lo que la tienda le vende hoy a esa cuenta: un exclusivo no se le nombra a un cliente
    // (RNF-04). Si no queda ninguno, el envío ya lo canceló antes de armar el correo
    const vendibles = carrito
      ? await this.carritoService.articulosALaVenta(
          this.prisma,
          todos.map((item) => item.articuloId),
          carrito.usuario.rol as Rol,
        )
      : new Map<number, unknown>();
    const items = todos.filter((item) => vendibles.has(item.articuloId));

    return correoRecordatorioCarrito({
      asunto,
      nombre,
      articulos: items.map(({ cantidad, articulo }) => ({
        descripcion: [
          articulo.formato?.producto.nombre ?? articulo.pack?.nombre ?? '',
          articulo.formato?.nombreFormato,
        ]
          .filter(Boolean)
          .join(' · '),
        cantidad,
      })),
      urlCarrito: this.rutas.carrito,
      enlaceBaja: this.firmaBaja.enlace(destinatario),
      enlacesPie: this.rutas.pie,
    });
  }

  private async pagoConfirmado(
    nombre: string,
    { asunto, pedidoId }: NotificacionACorreo,
  ): Promise<CorreoRenderizado> {
    const pedido = await this.prisma.pedido.findUniqueOrThrow({
      where: { id: pedidoId ?? -1 },
      select: {
        codigoPublico: true,
        porcentajeIva: true,
        montoIva: true,
        montoTotal: true,
        detalles: {
          select: {
            cantidad: true,
            precioUnitarioNetoAplicado: true,
            articulo: {
              select: {
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
            costoNeto: true,
            calle: true,
            numero: true,
            referencia: true,
            comuna: { select: { nombre: true } },
          },
        },
      },
    });
    const iva = Number(pedido.porcentajeIva);

    return correoPagoConfirmado({
      asunto,
      nombre,
      codigoPedido: pedido.codigoPublico,
      lineas: pedido.detalles.map(
        ({ cantidad, precioUnitarioNetoAplicado, articulo }) => ({
          descripcion: [
            articulo.formato?.producto.nombre ?? articulo.pack?.nombre ?? '',
            articulo.formato?.nombreFormato,
            cantidad === 1 ? '1 unidad' : `${cantidad} unidades`,
          ]
            .filter(Boolean)
            .join(' · '),
          monto:
            precioConIva(Number(precioUnitarioNetoAplicado), iva) * cantidad,
        }),
      ),
      despacho: pedido.envio && {
        comuna: pedido.envio.comuna.nombre,
        costo: precioConIva(Number(pedido.envio.costoNeto), iva),
      },
      total: pedido.montoTotal,
      iva: pedido.montoIva,
      entrega: pedido.envio
        ? `Despacho a domicilio · ${direccionDe(pedido.envio)}`
        : 'Retiro en tienda',
      urlPedido: this.rutas.pedido(pedido.codigoPublico),
      enlacesPie: this.rutas.pie,
    });
  }

  private async cambioEstado(
    { nombre, estado, tipoEntrega }: TrabajoCambioEstadoPedido,
    { asunto, pedidoId }: NotificacionACorreo,
  ): Promise<CorreoRenderizado> {
    const pedido = await this.prisma.pedido.findUniqueOrThrow({
      where: { id: pedidoId ?? -1 },
      select: {
        codigoPublico: true,
        historial: {
          select: { estado: true, fechaHora: true },
          orderBy: { correlativo: 'asc' },
        },
        envio: {
          select: {
            codigoSeguimiento: true,
            calle: true,
            numero: true,
            referencia: true,
            comuna: { select: { nombre: true } },
          },
        },
      },
    });

    // Con correcciones un estado se repite: vale su última vez
    const fechas = new Map(
      pedido.historial.map((cambio) => [cambio.estado, cambio.fechaHora]),
    );
    const pasosDelPedido =
      tipoEntrega === TIPOS_ENTREGA.RETIRO ? PASOS_RETIRO : PASOS_DESPACHO;
    const actual = pasosDelPedido.findIndex(([paso]) => paso === estado);
    const pasos: PasoPedido[] = pasosDelPedido.map(
      ([paso, etiqueta], indice) => {
        const fecha = indice <= actual ? fechas.get(paso) : undefined;
        return {
          etiqueta,
          fecha: fecha ? fechaCorta(fecha) : null,
          situacion:
            indice < actual ? 'hecho' : indice === actual ? 'actual' : 'futuro',
        };
      },
    );

    return correoCambioEstado({
      asunto,
      nombre,
      codigoPedido: pedido.codigoPublico,
      estado,
      fecha: fechas.get(estado) ?? new Date(),
      pasos,
      envio: pedido.envio && {
        // El único courier; `servicioEnvio` es la modalidad que cotizó (E7-H2)
        servicio: 'Chilexpress',
        codigoSeguimiento: pedido.envio.codigoSeguimiento,
        direccion: direccionDe(pedido.envio),
      },
      urlPedido: this.rutas.pedido(pedido.codigoPublico),
      enlacesPie: this.rutas.pie,
    });
  }

  private async stockBajo(
    datos: TrabajoCorreo,
    asunto: string,
  ): Promise<CorreoRenderizado> {
    const urlInventario = this.rutas.inventario;
    // Reencolado por la revisión: NOTIFICACION no guarda el formato
    if (!('formato' in datos)) {
      return correoStockBajoRecuperado({ asunto, urlInventario });
    }
    const { formato, stockTotal, stockMinimo } = datos as TrabajoStockBajo;

    const [existencias, movimiento, entrada] = await Promise.all([
      this.prisma.existencia.findMany({
        where: { formatoId: formato.id, cantidad: { gt: 0 } },
        select: { ubicacion: { select: { codigo: true } } },
        orderBy: { ubicacion: { codigo: 'asc' } },
      }),
      this.prisma.movimientoInventario.findFirst({
        where: {
          formatoId: formato.id,
          tipo: { in: Object.keys(MOVIMIENTOS_QUE_DESCUENTAN) },
        },
        select: {
          tipo: true,
          fechaHora: true,
          pedido: { select: { codigoPublico: true } },
        },
        orderBy: [{ fechaHora: 'desc' }, { id: 'desc' }],
      }),
      // El mismo criterio de «última entrada» que la consulta de stock (E11-H5)
      this.prisma.detalleEntrada.findFirst({
        where: { formatoId: formato.id },
        select: {
          costoUnitarioNeto: true,
          entrada: {
            select: { proveedor: { select: { razonSocial: true } } },
          },
        },
        orderBy: [
          { entrada: { fechaRecepcion: 'desc' } },
          { entrada: { id: 'desc' } },
        ],
      }),
    ]);

    const filas: FilaDato[] = [{ etiqueta: 'SKU', valor: formato.sku }];
    if (existencias.length > 0) {
      filas.push({
        etiqueta: 'Ubicaciones',
        valor: existencias.map((e) => e.ubicacion.codigo).join(' · '),
      });
    }
    if (movimiento) {
      const tipo = MOVIMIENTOS_QUE_DESCUENTAN[movimiento.tipo];
      filas.push(
        {
          etiqueta: 'Movimiento',
          valor: movimiento.pedido
            ? `${tipo} · pedido ${movimiento.pedido.codigoPublico}`
            : tipo,
        },
        { etiqueta: 'Fecha', valor: fechaConHora(movimiento.fechaHora) },
      );
    }
    if (entrada) {
      filas.push(
        {
          etiqueta: 'Último proveedor',
          valor: entrada.entrada.proveedor.razonSocial,
        },
        {
          etiqueta: 'Último costo neto',
          valor: formatearPesos(Math.round(Number(entrada.costoUnitarioNeto))),
        },
      );
    }

    return correoStockBajo({
      asunto,
      formato: `${formato.producto} · ${formato.nombreFormato}`,
      stockTotal,
      stockMinimo,
      filas,
      urlInventario,
    });
  }
}
