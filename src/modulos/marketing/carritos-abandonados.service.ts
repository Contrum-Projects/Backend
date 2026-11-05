import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  COLAS,
  TRABAJOS_CORREO,
  type TrabajoRecordatorioCarrito,
} from '../../colas/colas.js';
import { encolarCorreos } from '../../colas/encolar-correo.js';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_NOTIFICACION,
} from '../../common/dominio/valores.js';
import type { Rol } from '../../common/dominio/roles.js';
import { bloquearCuenta } from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CarritoService } from '../carrito/carrito.service.js';
import {
  FIN_SERIE_HORAS,
  PLAZOS_RECORDATORIO_HORAS,
  puedeRecibirRecordatorio,
  recordatorioDebido,
  ROLES_CON_CARRITO,
} from './recordatorio-carrito.js';

export const ASUNTO_RECORDATORIO_CARRITO = 'Tus productos te esperan';

const HORA_MS = 60 * 60 * 1000;
const LOTE_CARRITOS = 100;

/**
 * Recordatorios de carritos abandonados (E12-H4, RF-12.04 y RF-12.09). Lo hace una tarea periódica
 * con los plazos guardados en la base: si Redis se cae, la pasada siguiente los alcanza (RNF-29).
 * El abandono queda registrado en el carrito (`fecha_recordatorio`, `recordatorios_enviados`) y
 * cada recordatorio en NOTIFICACION.
 */
@Injectable()
export class CarritosAbandonadosService {
  private readonly logger = new Logger(CarritosAbandonadosService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(COLAS.CORREOS) private readonly correos: Queue,
    private readonly carritoService: CarritoService,
  ) {}

  /**
   * Recorre los carritos con artículos cuyo dueño acepta publicidad y que llevan entre la primera
   * hora y el fin de la serie sin cambios. Lo que le toca a cada uno lo decide la regla con el
   * carrito bloqueado; una falla solo afecta a su carrito, que se reintenta en la pasada siguiente.
   */
  async enviarRecordatorios(ahora = new Date()): Promise<void> {
    const desde = new Date(ahora.getTime() - FIN_SERIE_HORAS * HORA_MS);
    const hasta = new Date(
      ahora.getTime() - PLAZOS_RECORDATORIO_HORAS[0] * HORA_MS,
    );
    let ultimoId = 0;
    for (;;) {
      const carritos = await this.prisma.carrito.findMany({
        where: {
          id: { gt: ultimoId },
          fechaActualizacion: { gt: desde, lte: hasta },
          items: { some: {} },
          usuario: {
            activo: true,
            rol: { in: [...ROLES_CON_CARRITO] },
            aceptaMarketingEmail: true,
            fechaVerificacionCorreo: { not: null },
          },
        },
        orderBy: { id: 'asc' },
        take: LOTE_CARRITOS,
        select: {
          id: true,
          fechaActualizacion: true,
          fechaRecordatorio: true,
          recordatoriosEnviados: true,
          usuario: { select: { codigoPublico: true } },
        },
      });

      for (const carrito of carritos) {
        // Sin recordatorio pendiente no hace falta bloquear nada
        if (!recordatorioDebido(carrito, ahora)) continue;
        try {
          await this.recordar(carrito.id, carrito.usuario.codigoPublico, ahora);
        } catch (error) {
          this.logger.error(
            `No se pudo recordar el carrito ${carrito.id}: ${(error as Error).message}`,
          );
        }
      }

      if (carritos.length < LOTE_CARRITOS) return;
      ultimoId = carritos[carritos.length - 1].id;
    }
  }

  /**
   * Con la cuenta bloqueada, como los cambios del carrito y la compra: si el cliente lo cambió
   * mientras tanto, la regla lo ve y no envía (CA2). Dos instancias tampoco envían dos veces el
   * mismo recordatorio. El carrito y su NOTIFICACION van en la misma transacción (RNF-12) y el
   * correo se encola después del commit.
   */
  private async recordar(
    carritoId: number,
    codigoPublico: string,
    ahora: Date,
  ): Promise<void> {
    const correo = await this.prisma.$transaction(async (tx) => {
      await bloquearCuenta(tx, codigoPublico);
      const carrito = await tx.carrito.findUnique({
        where: { id: carritoId },
        select: {
          fechaActualizacion: true,
          fechaRecordatorio: true,
          recordatoriosEnviados: true,
          items: { select: { articuloId: true } },
          usuario: {
            select: {
              id: true,
              email: true,
              nombre: true,
              activo: true,
              rol: true,
              aceptaMarketingEmail: true,
              fechaVerificacionCorreo: true,
            },
          },
        },
      });
      if (!carrito || carrito.items.length === 0) return null;
      if (!puedeRecibirRecordatorio(carrito.usuario)) return null;
      const debido = recordatorioDebido(carrito, ahora);
      if (!debido) return null;
      // Solo se recuerda lo que la tienda le vende hoy a esa cuenta: nunca un exclusivo a un
      // cliente (RNF-04) ni algo que ya no está a la venta
      const vendibles = await this.carritoService.articulosALaVenta(
        tx,
        carrito.items.map((item) => item.articuloId),
        carrito.usuario.rol as Rol,
      );
      if (vendibles.size === 0) return null;

      await tx.carrito.update({
        where: { id: carritoId },
        data: {
          recordatoriosEnviados: debido.numero,
          ...(debido.iniciaSerie && { fechaRecordatorio: ahora }),
          // Registrar el recordatorio no es un cambio del carrito: no mueve los plazos
          fechaActualizacion: carrito.fechaActualizacion,
        },
      });
      const { usuario } = carrito;
      const notificacion = await tx.notificacion.create({
        data: {
          usuarioId: usuario.id,
          tipo: TIPOS_NOTIFICACION.RECORDATORIO_CARRITO,
          asunto: ASUNTO_RECORDATORIO_CARRITO,
          estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
        },
        select: { id: true },
      });
      const datos: TrabajoRecordatorioCarrito = {
        notificacionId: notificacion.id,
        destinatario: usuario.email,
        nombre: usuario.nombre,
      };
      return datos;
    });

    if (!correo) return;
    await encolarCorreos(
      this.correos,
      TRABAJOS_CORREO.RECORDATORIO_CARRITO,
      [correo],
      this.logger,
    );
  }
}
