import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { TrabajoStockBajo } from '../../colas/colas.js';
import { montosPorLineas } from '../../common/dominio/montos.js';
import { ROLES, type Rol } from '../../common/dominio/roles.js';
import {
  ESTADOS_ENVIO,
  ESTADOS_PEDIDO,
  SERVICIOS_ENVIO,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
  TIPOS_PRECIO,
} from '../../common/dominio/valores.js';
import { MAXIMO_INT4 } from '../../common/validacion/enteros.js';
import type { Entorno } from '../../config/entorno.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { bloquearCuenta } from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CarritoService } from '../carrito/carrito.service.js';
import { VentaStockService } from '../inventario/venta-stock.service.js';
import type { CrearPedidoDto } from './dto/crear-pedido.dto.js';
import {
  type DetallePedidoCuenta,
  MisPedidosService,
} from './mis-pedidos.service.js';

type Tx = Prisma.TransactionClient;

export const CORREO_SIN_CONFIRMAR =
  'Debes confirmar tu correo antes de comprar.';
export const CARRITO_VACIO = 'El carrito está vacío.';
export const PEDIDO_PENDIENTE =
  'Ya tienes un pedido pendiente de pago: págalo o espera a que se cancele antes de crear otro.';

/** Costo neto del despacho mientras no exista la cotización con el courier (E7-H2). */
const COSTO_DESPACHO_POR_COTIZAR = 0;
const LARGO_DESTINATARIO = 150;
const LARGO_CODIGO = 12;
// 32 símbolos sin los que se confunden (0/O, 1/I): cada byte se reduce sin sesgo
const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Código público del pedido, no adivinable (RNF-07). */
const generarCodigoPedido = (): string =>
  Array.from(
    randomBytes(LARGO_CODIGO),
    (byte) => ALFABETO_CODIGO[byte % ALFABETO_CODIGO.length],
  ).join('');

/**
 * Crea el pedido con lo que hay en el carrito de la cuenta (E5-H3). Todo va en una transacción
 * (RNF-12) con la cuenta bloqueada: dos confirmaciones simultáneas se ordenan y la segunda ve el
 * pedido ya creado o el carrito ya vacío.
 */
@Injectable()
export class CrearPedidoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
    private readonly carrito: CarritoService,
    private readonly ventaStock: VentaStockService,
    private readonly misPedidos: MisPedidosService,
  ) {}

  /**
   * E5-H3 · Confirma el carrito. Los precios se recalculan aquí (nunca llegan del navegador) y el
   * stock se reserva descontándolo con un movimiento de venta. Repetir la clave de idempotencia
   * devuelve el mismo pedido. El mínimo del profesional es de E5-H4 (SCRUM-46).
   */
  async crear(
    codigoPublico: string,
    rol: Rol,
    dto: CrearPedidoDto,
  ): Promise<DetallePedidoCuenta> {
    const { codigoPedido, avisos } = await this.prisma.$transaction((tx) =>
      this.crearEnTransaccion(tx, codigoPublico, rol, dto),
    );
    await this.ventaStock.encolarAvisos(avisos);
    return this.misPedidos.obtener(codigoPublico, codigoPedido);
  }

  private async crearEnTransaccion(
    tx: Tx,
    codigoPublico: string,
    rol: Rol,
    dto: CrearPedidoDto,
  ): Promise<{ codigoPedido: string; avisos: TrabajoStockBajo[] }> {
    const usuarioId = await bloquearCuenta(tx, codigoPublico);
    const repetido = await tx.pedido.findUnique({
      where: {
        usuarioId_claveIdempotencia: {
          usuarioId,
          claveIdempotencia: dto.claveIdempotencia,
        },
      },
      select: { codigoPublico: true },
    });
    if (repetido) {
      return { codigoPedido: repetido.codigoPublico, avisos: [] };
    }

    const cuenta = await tx.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
      select: {
        nombre: true,
        apellido: true,
        telefono: true,
        fechaVerificacionCorreo: true,
      },
    });
    if (!cuenta.fechaVerificacionCorreo) {
      throw new ForbiddenException(CORREO_SIN_CONFIRMAR);
    }

    // Un solo pedido sin pagar por cuenta, con la cuenta ya bloqueada: frena agotar el stock con
    // reservas que no se pagan. Repetir la clave no llega aquí: devuelve el mismo pedido
    const pendiente = await tx.pedido.findFirst({
      where: { usuarioId, estadoActual: ESTADOS_PEDIDO.PENDIENTE_PAGO },
      select: { id: true },
    });
    if (pendiente) throw new ConflictException(PEDIDO_PENDIENTE);

    const carrito = await tx.carrito.findUnique({
      where: { usuarioId },
      select: {
        id: true,
        items: {
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
          orderBy: { articuloId: 'asc' },
        },
      },
    });
    if (!carrito || carrito.items.length === 0) {
      throw new ConflictException(CARRITO_VACIO);
    }

    const datosFacturacionId = await this.exigirDatosFacturacion(
      tx,
      usuarioId,
      dto,
    );
    const direccion = await this.exigirDireccion(tx, usuarioId, dto);

    const aLaVenta = await this.carrito.articulosALaVenta(
      tx,
      carrito.items.map((item) => item.articuloId),
      rol,
    );
    const noVendidos = carrito.items.filter(
      (item) => !aLaVenta.has(item.articuloId),
    );
    if (noVendidos.length > 0) {
      const nombres = noVendidos.map(({ articulo }) =>
        articulo.formato
          ? `${articulo.formato.producto.nombre} ${articulo.formato.nombreFormato}`
          : (articulo.pack?.nombre ?? 'un artículo'),
      );
      throw new ConflictException(
        `Ya no está a la venta: ${nombres.join(', ')}. Quítalo del carrito para continuar.`,
      );
    }

    const lineas = carrito.items.map(({ articuloId, cantidad }) => ({
      articuloId,
      cantidad,
      netoGuardado: aLaVenta.get(articuloId)!.neto,
    }));
    const porcentajeIva = this.config.get('IVA_PORCENTAJE', { infer: true });
    const montos = montosPorLineas(
      direccion
        ? [...lineas, { netoGuardado: COSTO_DESPACHO_POR_COTIZAR, cantidad: 1 }]
        : lineas,
      porcentajeIva,
    );
    if (montos.total > MAXIMO_INT4) {
      throw new BadRequestException(
        'El total del pedido supera el máximo permitido.',
      );
    }

    const plazoMinutos = this.config.get('PLAZO_PAGO_MINUTOS', { infer: true });
    const tipoPrecio =
      rol === ROLES.PROFESIONAL
        ? TIPOS_PRECIO.MAYORISTA
        : TIPOS_PRECIO.MINORISTA;
    const pedido = await tx.pedido.create({
      data: {
        codigoPublico: generarCodigoPedido(),
        usuarioId,
        datosFacturacionId,
        claveIdempotencia: dto.claveIdempotencia,
        fechaExpiracionPago: new Date(Date.now() + plazoMinutos * 60_000),
        estadoActual: ESTADOS_PEDIDO.PENDIENTE_PAGO,
        tipoEntrega: dto.tipoEntrega,
        tipoDocumentoSolicitado: dto.tipoDocumento,
        porcentajeIva,
        montoNeto: montos.neto,
        montoIva: montos.iva,
        montoTotal: montos.total,
        detalles: {
          create: lineas.map(({ articuloId, cantidad, netoGuardado }) => ({
            articuloId,
            cantidad,
            precioUnitarioNetoAplicado: netoGuardado,
            tipoPrecio,
          })),
        },
        historial: {
          create: {
            correlativo: 1,
            usuarioId,
            estado: ESTADOS_PEDIDO.PENDIENTE_PAGO,
          },
        },
        envio: direccion
          ? {
              create: {
                comunaId: direccion.comunaId,
                servicioEnvio: SERVICIOS_ENVIO.POR_COTIZAR,
                costoNeto: COSTO_DESPACHO_POR_COTIZAR,
                estadoEnvio: ESTADOS_ENVIO.PENDIENTE,
                destinatario: `${cuenta.nombre} ${cuenta.apellido}`.slice(
                  0,
                  LARGO_DESTINATARIO,
                ),
                telefonoContacto: cuenta.telefono,
                calle: direccion.calle,
                numero: direccion.numero,
                referencia: direccion.referencia,
              },
            }
          : undefined,
      },
      select: { id: true, codigoPublico: true },
    });

    // Si un formato no alcanza responde 409 y se revierte todo, también el pedido
    const { avisos } = await this.ventaStock.descontarPorPedido(
      tx,
      pedido.id,
      lineas.map(({ articuloId, cantidad }) => ({ articuloId, cantidad })),
    );
    await tx.itemCarrito.deleteMany({ where: { carritoId: carrito.id } });
    await tx.carrito.update({
      where: { id: carrito.id },
      data: { fechaActualizacion: new Date() },
    });

    return { codigoPedido: pedido.codigoPublico, avisos };
  }

  /** Id de los datos de facturación si el documento es factura; 404 si no son de la cuenta. */
  private async exigirDatosFacturacion(
    tx: Tx,
    usuarioId: number,
    dto: CrearPedidoDto,
  ): Promise<number | null> {
    if (dto.tipoDocumento !== TIPOS_DOCUMENTO.FACTURA) return null;
    const datos = await tx.datosFacturacion.findFirst({
      where: { id: dto.datosFacturacionId, usuarioId, activo: true },
      select: { id: true },
    });
    if (!datos) {
      throw new NotFoundException('Los datos de facturación no existen.');
    }
    return datos.id;
  }

  /** La dirección si la entrega es despacho; 404 si no es de la cuenta. */
  private async exigirDireccion(
    tx: Tx,
    usuarioId: number,
    dto: CrearPedidoDto,
  ) {
    if (dto.tipoEntrega !== TIPOS_ENTREGA.DESPACHO) return null;
    const direccion = await tx.direccion.findFirst({
      where: { id: dto.direccionId, usuarioId },
      select: { comunaId: true, calle: true, numero: true, referencia: true },
    });
    if (!direccion) throw new NotFoundException('La dirección no existe.');
    return direccion;
  }
}
