import { Injectable, Logger } from '@nestjs/common';
import { AlmacenArchivos } from '../../almacen/almacen-archivos.js';
import { AlmacenNoConfigurado } from '../../almacen/almacen-r2.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  ESTADOS_RESUELTOS,
  limiteConservacionArchivos,
} from './limpieza-verificacion.js';

const LOTE_ANTECEDENTES = 100;

export interface ResumenLimpieza {
  /** Archivos borrados del almacén con su fecha de eliminación registrada. */
  eliminados: number;
  /** Archivos que el almacén no pudo borrar: quedan para la pasada siguiente. */
  fallidos: number;
}

/**
 * Elimina los archivos de verificación que ya no hacen falta (E10-H6, RF-10.12): los de las
 * solicitudes aprobadas o rechazadas hace 30 días o más. Se borra solo el archivo del almacén; la
 * solicitud con su resolución y la consulta al SII se conservan, y de cada antecedente quedan el
 * tipo, el nombre y el hash, con la fecha de eliminación (E10-H7 responde 410 desde ahí).
 *
 * Lo corre una tarea programada. Primero se borra el archivo y después se registra: si la base
 * falla, la pasada siguiente lo vuelve a borrar sin error (`eliminar` no falla si ya no existe).
 */
@Injectable()
export class LimpiezaVerificacionService {
  private readonly logger = new Logger(LimpiezaVerificacionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almacen: AlmacenArchivos,
  ) {}

  async eliminarArchivosVencidos(ahora = new Date()): Promise<ResumenLimpieza> {
    const resumen: ResumenLimpieza = { eliminados: 0, fallidos: 0 };
    // Sin R2 no se pudo subir nada, y si se perdió su configuración los archivos siguen ahí:
    // marcarlos como eliminados los dejaría guardados para siempre
    if (this.almacen instanceof AlmacenNoConfigurado) return resumen;

    const limite = limiteConservacionArchivos(ahora);
    let ultimoId = 0;
    for (;;) {
      const lote = await this.prisma.antecedente.findMany({
        where: {
          id: { gt: ultimoId },
          fechaEliminacionArchivo: null,
          solicitud: {
            estado: { in: [...ESTADOS_RESUELTOS] },
            fechaResolucion: { lte: limite },
          },
        },
        orderBy: { id: 'asc' },
        take: LOTE_ANTECEDENTES,
        select: { id: true, ubicacionArchivo: true },
      });

      for (const antecedente of lote) {
        try {
          await this.almacen.eliminar(antecedente.ubicacionArchivo);
        } catch (error) {
          // Sin la ubicación en el log (lleva la cuenta del solicitante) ni el mensaje del error,
          // que podría traerla: solo el tipo de error
          resumen.fallidos += 1;
          this.logger.warn(
            `No se pudo eliminar el archivo del antecedente ${antecedente.id}: ${(error as Error).name}`,
          );
          continue;
        }
        // Con la condición, dos pasadas a la vez no registran dos fechas
        const { count } = await this.prisma.antecedente.updateMany({
          where: { id: antecedente.id, fechaEliminacionArchivo: null },
          data: { fechaEliminacionArchivo: ahora },
        });
        resumen.eliminados += count;
      }

      if (lote.length < LOTE_ANTECEDENTES) break;
      ultimoId = lote[lote.length - 1].id;
    }

    if (resumen.eliminados > 0 || resumen.fallidos > 0) {
      this.logger.log(
        `Archivos de verificación eliminados: ${resumen.eliminados}; con falla: ${resumen.fallidos}.`,
      );
    }
    return resumen;
  }
}
