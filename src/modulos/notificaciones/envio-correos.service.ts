import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  TRABAJOS_CORREO,
  type TrabajoCambioEstadoPedido,
  type TrabajoCorreo,
} from '../../colas/colas.js';
import { hoyEnLaTienda } from '../../common/dominio/fechas.js';
import {
  type Rol,
  ROLES,
  ROLES_COMPRADOR,
} from '../../common/dominio/roles.js';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_NOTIFICACION_PUBLICIDAD,
} from '../../common/dominio/valores.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CarritoService } from '../carrito/carrito.service.js';
import { esCumpleanosHoy } from '../marketing/regla-cumpleanos.js';
import { asuntoCambioEstado } from '../pedidos/transiciones-estado-pedido.js';
import { CLIENTE_CORREO, type ClienteCorreo } from './cliente-correo.js';
import { ContenidoCorreosService } from './contenido-correos.service.js';

/**
 * Misma clave para los reintentos de un mismo correo: Resend no lo duplica si el proceso cayó justo
 * después de enviar. Un enlace regenerado por la revisión es otro correo, y lleva otra clave. Se
 * deriva del hash: el token en claro no sale hacia el proveedor en la clave.
 */
const claveIdempotencia = (datos: TrabajoCorreo): string => {
  const base = `notificacion-${datos.notificacionId}`;
  if (!('enlace' in datos)) return base;
  const huella = createHash('sha256').update(datos.enlace).digest('hex');
  return `${base}-${huella.slice(0, 16)}`;
};

/** Lleva costo y proveedor: solo para quien sigue activo con un rol que puede verlos (RNF-28). */
const puedeRecibirStockBajo = (
  usuario: { activo: boolean; rol: string } | null,
): boolean =>
  !!usuario?.activo &&
  (usuario.rol === ROLES.BODEGUERO || usuario.rol === ROLES.ADMINISTRADOR);

/**
 * Avisa que la cuenta ve el precio mayorista: si la desactivaron o le cambiaron el rol antes del
 * envío, ya no es cierto (E10-H4).
 */
const sigueProfesional = (
  usuario: { activo: boolean; rol: string } | null,
): boolean => !!usuario?.activo && usuario.rol === ROLES.PROFESIONAL;

/**
 * E12-H5 · El saludo sale el mismo día de Chile en que se decidió y solo si la cuenta sigue de
 * cumpleaños hoy: con la fecha borrada o cambiada a otro día, ya no corresponde (CA3).
 */
const sigueDeCumpleanos = (
  fechaCreacion: Date,
  usuario: { fechaNacimiento: Date | null } | null,
): boolean => {
  const ahora = new Date();
  return (
    hoyEnLaTienda(fechaCreacion) === hoyEnLaTienda(ahora) &&
    !!usuario?.fechaNacimiento &&
    esCumpleanosHoy(usuario.fechaNacimiento, ahora)
  );
};

/** Publicidad: todo correo de una campaña y los tipos marcados como tales (E12-H2). */
const esPublicidad = (notificacion: {
  tipo: string;
  campanaId: number | null;
}): boolean =>
  typeof notificacion.campanaId === 'number' ||
  TIPOS_NOTIFICACION_PUBLICIDAD.includes(notificacion.tipo);

/**
 * El consentimiento se revisa de nuevo al enviar (E12-H2): una cuenta activa, con el correo
 * verificado, que acepta ofertas y que compra en la tienda (el personal nunca recibe publicidad,
 * E12-H3), o un suscriptor confirmado y sin baja. Sin destinatario, no. Que el suscriptor no tenga
 * cuenta con el mismo correo lo revisa `EnvioCorreosService` en la base.
 */
const aceptaPublicidad = (notificacion: {
  usuario: {
    activo: boolean;
    rol: string;
    aceptaMarketingEmail: boolean;
    fechaVerificacionCorreo: Date | null;
  } | null;
  lead: { activo: boolean } | null;
}): boolean => {
  const { usuario, lead } = notificacion;
  if (usuario) {
    return (
      usuario.activo &&
      ROLES_COMPRADOR.includes(usuario.rol as Rol) &&
      usuario.aceptaMarketingEmail &&
      usuario.fechaVerificacionCorreo !== null
    );
  }
  return !!lead?.activo;
};

/** Un cambio de estado reencolado avisa el estado actual: el asunto guardado puede ser anterior. */
const asuntoDe = (
  trabajo: string,
  datos: TrabajoCorreo,
  asuntoGuardado: string,
): string => {
  if (trabajo !== TRABAJOS_CORREO.CAMBIO_ESTADO_PEDIDO) return asuntoGuardado;
  const { codigoPedido, estado } = datos as TrabajoCambioEstadoPedido;
  return asuntoCambioEstado(codigoPedido, estado);
};

/** Envía el correo de un trabajo y deja su resultado en NOTIFICACION (E1-H6). */
@Injectable()
export class EnvioCorreosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contenido: ContenidoCorreosService,
    @Inject(CLIENTE_CORREO) private readonly cliente: ClienteCorreo,
    private readonly carritoService: CarritoService,
  ) {}

  async enviar(trabajo: string, datos: TrabajoCorreo): Promise<void> {
    const { notificacionId: id, destinatario } = datos;
    const notificacion = await this.prisma.notificacion.findUnique({
      where: { id },
      select: {
        estadoEnvio: true,
        asunto: true,
        tipo: true,
        pedidoId: true,
        campanaId: true,
        usuario: {
          select: {
            activo: true,
            rol: true,
            aceptaMarketingEmail: true,
            fechaVerificacionCorreo: true,
            fechaNacimiento: true,
          },
        },
        lead: { select: { activo: true, email: true } },
        usuarioId: true,
        fechaCreacion: true,
      },
    });
    // Ya resuelta o borrada: un trabajo repetido no vuelve a enviar
    if (notificacion?.estadoEnvio !== ESTADOS_NOTIFICACION.PENDIENTE) return;

    if (
      esPublicidad(notificacion) &&
      (!aceptaPublicidad(notificacion) ||
        (await this.suscriptorConCuenta(notificacion)))
    ) {
      await this.marcarCancelada(id);
      return;
    }
    if (
      trabajo === TRABAJOS_CORREO.RECORDATORIO_CARRITO &&
      !(await this.recordatorioVigente(
        notificacion.usuarioId,
        notificacion.usuario?.rol,
        notificacion.fechaCreacion,
      ))
    ) {
      await this.marcarCancelada(id);
      return;
    }

    // E12-H5 · El saludo es del día del cumpleaños: uno atrasado (Redis caído, reintentos) no sale
    // al día siguiente, ni si la cuenta borró su fecha de nacimiento o la cambió a otro día (CA3)
    if (
      trabajo === TRABAJOS_CORREO.CUMPLEANOS &&
      !sigueDeCumpleanos(notificacion.fechaCreacion, notificacion.usuario)
    ) {
      await this.marcarCancelada(id);
      return;
    }

    if (
      trabajo === TRABAJOS_CORREO.STOCK_BAJO &&
      !puedeRecibirStockBajo(notificacion.usuario)
    ) {
      await this.marcarFallida(id);
      return;
    }
    if (
      trabajo === TRABAJOS_CORREO.VERIFICACION_APROBADA &&
      !sigueProfesional(notificacion.usuario)
    ) {
      await this.marcarFallida(id);
      return;
    }

    await this.prisma.notificacion.update({
      where: { id },
      data: { intentos: { increment: 1 } },
    });
    const asunto = asuntoDe(trabajo, datos, notificacion.asunto);
    const correo = await this.contenido.construir(trabajo, datos, {
      asunto,
      pedidoId: notificacion.pedidoId,
      usuarioId: notificacion.usuarioId,
      campanaId: notificacion.campanaId,
    });
    await this.cliente.enviar({
      notificacionId: id,
      para: destinatario,
      asunto: correo.asunto ?? asunto,
      html: correo.html,
      texto: correo.texto,
      claveIdempotencia: claveIdempotencia(datos),
    });
    await this.prisma.notificacion.updateMany({
      where: { id, estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE },
      data: {
        estadoEnvio: ESTADOS_NOTIFICACION.ENVIADA,
        fechaEnvio: new Date(),
      },
    });
  }

  /**
   * E12-H4 · CA2: si el cliente compró o modificó el carrito después de decidirse el recordatorio
   * (un reintento o un correo reencolado), ya no corresponde enviarlo. Tampoco si ninguno de sus
   * artículos sigue a la venta para la cuenta (RNF-04: un exclusivo no se le ofrece a un cliente).
   */
  private async recordatorioVigente(
    usuarioId: number | null,
    rol: string | undefined,
    decidido: Date,
  ): Promise<boolean> {
    if (usuarioId === null || !rol) return false;
    const carrito = await this.prisma.carrito.findUnique({
      where: { usuarioId },
      select: {
        fechaActualizacion: true,
        items: { select: { articuloId: true } },
      },
    });
    if (!carrito || carrito.items.length === 0) return false;
    if (carrito.fechaActualizacion.getTime() > decidido.getTime()) return false;
    const vendibles = await this.carritoService.articulosALaVenta(
      this.prisma,
      carrito.items.map((item) => item.articuloId),
      rol as Rol,
    );
    return vendibles.size > 0;
  }

  /**
   * E12-H3 (decisión del 5 de noviembre de 2026): si el correo de un suscriptor sin cuenta ya es el
   * de una cuenta, decide la cuenta. La publicidad no le llega por el LEAD aunque la cuenta no la
   * acepte o sea del personal. Ambos correos se guardan en minúsculas (`Correo`).
   */
  private async suscriptorConCuenta(notificacion: {
    usuario: unknown;
    lead: { email: string } | null;
  }): Promise<boolean> {
    if (notificacion.usuario || !notificacion.lead) return false;
    const cuentas = await this.prisma.usuario.count({
      where: { email: notificacion.lead.email },
    });
    return cuentas > 0;
  }

  /** Reintentos agotados: solo cambia la notificación, nunca la cuenta ni el pedido. */
  async marcarFallida(id: number): Promise<void> {
    await this.prisma.notificacion.updateMany({
      where: { id, estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE },
      data: { estadoEnvio: ESTADOS_NOTIFICACION.FALLIDA },
    });
  }

  /** E12-H2 · Publicidad para una dirección que ya no la acepta: no se envía. */
  async marcarCancelada(id: number): Promise<void> {
    await this.prisma.notificacion.updateMany({
      where: { id, estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE },
      data: { estadoEnvio: ESTADOS_NOTIFICACION.CANCELADA },
    });
  }
}
