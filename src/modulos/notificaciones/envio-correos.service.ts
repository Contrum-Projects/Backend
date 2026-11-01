import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  TRABAJOS_CORREO,
  type TrabajoCambioEstadoPedido,
  type TrabajoCorreo,
} from '../../colas/colas.js';
import { ROLES } from '../../common/dominio/roles.js';
import { ESTADOS_NOTIFICACION } from '../../common/dominio/valores.js';
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
        pedidoId: true,
        usuario: { select: { activo: true, rol: true } },
      },
    });
    // Ya resuelta o borrada: un trabajo repetido no vuelve a enviar
    if (notificacion?.estadoEnvio !== ESTADOS_NOTIFICACION.PENDIENTE) return;

    if (
      trabajo === TRABAJOS_CORREO.STOCK_BAJO &&
      !puedeRecibirStockBajo(notificacion.usuario)
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
}
