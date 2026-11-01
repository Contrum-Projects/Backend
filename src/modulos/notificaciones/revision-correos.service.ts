import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import {
  COLAS,
  TRABAJOS_CORREO,
  type TrabajoCambioEstadoPedido,
  type TrabajoCorreo,
  type TrabajoCorreoConEnlace,
  type TrabajoPagoConfirmado,
  type TrabajoStockBajoRecuperado,
} from '../../colas/colas.js';
import {
  encolarCorreos,
  idTrabajoCorreo,
  INTENTOS_CORREO,
} from '../../colas/encolar-correo.js';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_NOTIFICACION,
  TIPOS_TOKEN,
} from '../../common/dominio/valores.js';
import type { Entorno } from '../../config/entorno.js';
import { bloquearCuenta } from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { generarTokenCorreo } from '../cuentas/tokens.js';
import { ESTADOS_CON_AVISO } from '../pedidos/transiciones-estado-pedido.js';

/** Margen para no tomar un correo que recién se está encolando después de su commit. */
const ANTIGUEDAD_MINIMA_MS = 2 * 60 * 1000;
const POR_REVISION = 100;

/** Correos de cuenta y a dónde lleva el enlace de cada uno (el token no se puede rearmar). */
const CORREOS_CON_ENLACE: Record<
  string,
  { trabajo: string; tipoToken: string; ruta: string }
> = {
  [TIPOS_NOTIFICACION.CONFIRMACION_CORREO]: {
    trabajo: TRABAJOS_CORREO.CONFIRMACION_CORREO,
    tipoToken: TIPOS_TOKEN.CONFIRMACION_CORREO,
    ruta: 'confirmar-correo',
  },
  [TIPOS_NOTIFICACION.RECUPERACION_CONTRASENA]: {
    trabajo: TRABAJOS_CORREO.RECUPERACION_CONTRASENA,
    tipoToken: TIPOS_TOKEN.RECUPERACION_CONTRASENA,
    ruta: 'restablecer-contrasena',
  },
  [TIPOS_NOTIFICACION.INVITACION_PERSONAL]: {
    trabajo: TRABAJOS_CORREO.INVITACION_PERSONAL,
    tipoToken: TIPOS_TOKEN.INVITACION_PERSONAL,
    ruta: 'personal/activar',
  },
};

const TIPOS_QUE_ENVIA = [
  ...Object.keys(CORREOS_CON_ENLACE),
  TIPOS_NOTIFICACION.PAGO_CONFIRMADO,
  TIPOS_NOTIFICACION.CAMBIO_ESTADO_PEDIDO,
  TIPOS_NOTIFICACION.STOCK_BAJO,
];

interface Pendiente {
  id: number;
  tipo: string;
  intentos: number;
  usuario: {
    id: number;
    codigoPublico: string;
    email: string;
    nombre: string;
    activo: boolean;
    fechaVerificacionCorreo: Date | null;
  } | null;
  pedido: {
    codigoPublico: string;
    montoTotal: number;
    estadoActual: string;
    tipoEntrega: string;
  } | null;
}

interface CorreoRecuperado {
  trabajo: string;
  datos: TrabajoCorreo;
}

/**
 * Revisión periódica (RNF-29): si Redis se cayó o se vació, vuelve a encolar las NOTIFICACION
 * pendientes que no están en la cola. Lo que ya no se puede enviar queda `fallida`.
 */
@Injectable()
export class RevisionCorreosService {
  private readonly logger = new Logger(RevisionCorreosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
    @InjectQueue(COLAS.CORREOS) private readonly correos: Queue,
  ) {}

  async revisarPendientes(): Promise<void> {
    const pendientes = await this.prisma.notificacion.findMany({
      where: {
        estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
        tipo: { in: TIPOS_QUE_ENVIA },
        fechaCreacion: { lt: new Date(Date.now() - ANTIGUEDAD_MINIMA_MS) },
      },
      select: {
        id: true,
        tipo: true,
        intentos: true,
        usuario: {
          select: {
            id: true,
            codigoPublico: true,
            email: true,
            nombre: true,
            activo: true,
            fechaVerificacionCorreo: true,
          },
        },
        pedido: {
          select: {
            codigoPublico: true,
            montoTotal: true,
            estadoActual: true,
            tipoEntrega: true,
          },
        },
      },
      orderBy: { id: 'asc' },
      take: POR_REVISION,
    });

    for (const pendiente of pendientes) {
      // Sigue en la cola, esperando o entre reintentos: regenerar su token dejaría muerto su enlace
      if (await this.correos.getJob(idTrabajoCorreo(pendiente.id))) continue;

      const recuperado =
        pendiente.intentos < INTENTOS_CORREO
          ? await this.recuperar(pendiente)
          : null;
      if (!recuperado) {
        await this.marcarFallida(pendiente.id);
        continue;
      }
      await encolarCorreos(
        this.correos,
        recuperado.trabajo,
        [recuperado.datos],
        this.logger,
      );
    }
  }

  private recuperar(pendiente: Pendiente): Promise<CorreoRecuperado | null> {
    if (pendiente.tipo in CORREOS_CON_ENLACE) {
      return this.recuperarConEnlace(pendiente);
    }
    return Promise.resolve(this.recuperarAviso(pendiente));
  }

  /** Los datos de estos correos se pueden rearmar desde la base. */
  private recuperarAviso({
    id: notificacionId,
    tipo,
    usuario,
    pedido,
  }: Pendiente): CorreoRecuperado | null {
    if (!usuario) return null;
    const persona = {
      notificacionId,
      destinatario: usuario.email,
      nombre: usuario.nombre,
    };
    if (tipo === TIPOS_NOTIFICACION.STOCK_BAJO) {
      if (!usuario.activo) return null;
      const datos: TrabajoStockBajoRecuperado = persona;
      return { trabajo: TRABAJOS_CORREO.STOCK_BAJO, datos };
    }
    if (!pedido) return null;
    if (tipo === TIPOS_NOTIFICACION.PAGO_CONFIRMADO) {
      const datos: TrabajoPagoConfirmado = {
        ...persona,
        codigoPedido: pedido.codigoPublico,
        montoTotal: pedido.montoTotal,
      };
      return { trabajo: TRABAJOS_CORREO.PAGO_CONFIRMADO, datos };
    }
    // Se avisa el estado actual; si el pedido retrocedió a uno sin aviso, ya no hay qué avisar
    if (!ESTADOS_CON_AVISO.includes(pedido.estadoActual)) return null;
    const datos: TrabajoCambioEstadoPedido = {
      ...persona,
      codigoPedido: pedido.codigoPublico,
      estado: pedido.estadoActual,
      tipoEntrega: pedido.tipoEntrega,
    };
    return { trabajo: TRABAJOS_CORREO.CAMBIO_ESTADO_PEDIDO, datos };
  }

  /**
   * Solo se guarda el hash del token, así que el enlace perdido no se puede rearmar: se reemplaza
   * el token por uno nuevo, en la misma fila, con el vencimiento original (el enlace anterior deja
   * de servir). Si ya no hay un enlace vigente que reemplazar o el correo ya no corresponde, no
   * hay nada que enviar. La fila de la cuenta bloqueada ordena esto con pedir un enlace nuevo.
   */
  private recuperarConEnlace({
    id: notificacionId,
    tipo,
    usuario,
  }: Pendiente): Promise<CorreoRecuperado | null> {
    const { trabajo, tipoToken, ruta } = CORREOS_CON_ENLACE[tipo];
    if (!usuario) return Promise.resolve(null);

    return this.prisma.$transaction(async (tx) => {
      await bloquearCuenta(tx, usuario.codigoPublico);
      // Otra instancia pudo enviarlo tras la lectura inicial: reemplazar su token mataría ese enlace
      const notificacion = await tx.notificacion.findUnique({
        where: { id: notificacionId },
        select: { estadoEnvio: true },
      });
      if (notificacion?.estadoEnvio !== ESTADOS_NOTIFICACION.PENDIENTE) {
        return null;
      }
      const cuenta = await tx.usuario.findUniqueOrThrow({
        where: { id: usuario.id },
        select: { activo: true, fechaVerificacionCorreo: true },
      });
      const yaConfirmada =
        tipo === TIPOS_NOTIFICACION.CONFIRMACION_CORREO &&
        cuenta.fechaVerificacionCorreo !== null;
      if (!cuenta.activo || yaConfirmada) return null;

      // Pedir otro enlace dejó uno más nuevo: reemplazar su token lo anularía
      const masNueva = await tx.notificacion.findFirst({
        where: { usuarioId: usuario.id, tipo, id: { gt: notificacionId } },
        select: { id: true },
      });
      if (masNueva) return null;

      const vigencia = { fechaUso: null, fechaExpiracion: { gt: new Date() } };
      const vigente = await tx.tokenCorreo.findFirst({
        where: { usuarioId: usuario.id, tipo: tipoToken, ...vigencia },
        select: { id: true },
        orderBy: { id: 'desc' },
      });
      if (!vigente) return null;

      const { token, hash } = generarTokenCorreo();
      // Con condición atómica: consumirlo no toma el bloqueo de la cuenta y pudo intercalarse
      const { count } = await tx.tokenCorreo.updateMany({
        where: { id: vigente.id, ...vigencia },
        data: { tokenHash: hash },
      });
      if (count === 0) return null;
      const datos: TrabajoCorreoConEnlace = {
        notificacionId,
        destinatario: usuario.email,
        nombre: usuario.nombre,
        enlace: `${this.urlTienda}/${ruta}?token=${encodeURIComponent(token)}`,
      };
      return { trabajo, datos };
    });
  }

  private get urlTienda(): string {
    return this.config.get('URL_TIENDA', { infer: true }).replace(/\/+$/, '');
  }

  private async marcarFallida(id: number): Promise<void> {
    await this.prisma.notificacion.updateMany({
      where: { id, estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE },
      data: { estadoEnvio: ESTADOS_NOTIFICACION.FALLIDA },
    });
  }
}
