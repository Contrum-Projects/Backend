import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  TRABAJOS_CORREO,
  type TrabajoCambioEstadoPedido,
  type TrabajoCorreo,
} from '../../colas/colas.js';
import { ROLES } from '../../common/dominio/roles.js';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_NOTIFICACION_PUBLICIDAD,
} from '../../common/dominio/valores.js';
import { PrismaService } from '../../prisma/prisma.service.js';
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

/** Publicidad: todo correo de una campaña y los tipos marcados como tales (E12-H2). */
const esPublicidad = (notificacion: {
  tipo: string;
  campanaId: number | null;
}): boolean =>
  typeof notificacion.campanaId === 'number' ||
  TIPOS_NOTIFICACION_PUBLICIDAD.includes(notificacion.tipo);

/**
 * El consentimiento se revisa de nuevo al enviar (E12-H2): una cuenta activa, con el correo
 * verificado, que acepta ofertas, o un suscriptor confirmado y sin baja. Sin destinatario, no.
 */
const aceptaPublicidad = (notificacion: {
  usuario: {
    activo: boolean;
    aceptaMarketingEmail: boolean;
    fechaVerificacionCorreo: Date | null;
  } | null;
  lead: { activo: boolean } | null;
}): boolean => {
  const { usuario, lead } = notificacion;
  if (usuario) {
    return (
      usuario.activo &&
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
          },
        },
        lead: { select: { activo: true } },
        usuarioId: true,
        usuario: { select: { activo: true, rol: true } },
      },
    });
    // Ya resuelta o borrada: un trabajo repetido no vuelve a enviar
    if (notificacion?.estadoEnvio !== ESTADOS_NOTIFICACION.PENDIENTE) return;

    if (esPublicidad(notificacion) && !aceptaPublicidad(notificacion)) {
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
    const { html, texto } = await this.contenido.construir(trabajo, datos, {
      asunto,
      pedidoId: notificacion.pedidoId,
      usuarioId: notificacion.usuarioId,
    });
    await this.cliente.enviar({
      notificacionId: id,
      para: destinatario,
      asunto,
      html,
      texto,
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
