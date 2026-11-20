import { Injectable, Logger } from '@nestjs/common';
import { ORIGENES_ERROR } from '../../common/dominio/valores.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  LARGO_COMPONENTE,
  LARGO_MENSAJE,
  LARGO_TIPO_ERROR,
  LARGO_TRAZA,
  recortar,
  rutaSinQuery,
} from './datos-error.js';
import type { ReporteErrorClienteDto } from './dto/reporte-error-cliente.dto.js';

export type OrigenError = (typeof ORIGENES_ERROR)[keyof typeof ORIGENES_ERROR];

export interface NuevoRegistroError {
  codigoSeguimiento: string;
  origen: OrigenError;
  componente: string;
  metodo?: string | null;
  ruta?: string | null;
  estadoHttp?: number | null;
  tipoError: string;
  mensaje: string;
  traza?: string | null;
  /** `codigoPublico` de la cuenta con sesión, si la había. */
  usuario?: string | null;
}

/** Guarda los errores en `registro_error` (SCRUM-168). */
@Injectable()
export class RegistroErroresService {
  private readonly logger = new Logger(RegistroErroresService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Guarda el error. Nunca lanza: si la base no responde, el error ya quedó en el log y la
   * respuesta a la persona no cambia (criterio 5).
   */
  async guardar(datos: NuevoRegistroError): Promise<void> {
    try {
      const usuarioId = datos.usuario
        ? (
            await this.prisma.usuario.findUnique({
              where: { codigoPublico: datos.usuario },
              select: { id: true },
            })
          )?.id
        : undefined;
      await this.prisma.registroError.create({
        data: {
          codigoSeguimiento: datos.codigoSeguimiento,
          origen: datos.origen,
          componente: recortar(datos.componente, LARGO_COMPONENTE),
          metodo: datos.metodo ?? null,
          ruta: datos.ruta ? rutaSinQuery(datos.ruta) : null,
          estadoHttp: datos.estadoHttp ?? null,
          tipoError: recortar(datos.tipoError, LARGO_TIPO_ERROR),
          mensaje: recortar(datos.mensaje, LARGO_MENSAJE),
          traza: datos.traza ? recortar(datos.traza, LARGO_TRAZA) : null,
          usuarioId: usuarioId ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo guardar el error ${datos.codigoSeguimiento} en registro_error: ${
          error instanceof Error ? error.name : 'error desconocido'
        }`,
      );
    }
  }

  /**
   * Error que reporta la tienda o el panel. Si el frontend ya tenía un código (el de una
   * respuesta 5xx de la API), lo conserva para unir los dos registros; si no, usa el de esta
   * petición.
   */
  async registrarDelCliente(
    dto: ReporteErrorClienteDto,
    codigoPeticion: string,
    usuario: string | undefined,
  ): Promise<{ codigoSeguimiento: string }> {
    const codigoSeguimiento = dto.codigoSeguimiento ?? codigoPeticion;
    await this.guardar({
      codigoSeguimiento,
      origen: dto.origen,
      componente: dto.componente,
      ruta: dto.ruta ?? null,
      tipoError: dto.tipoError ?? 'Error',
      mensaje: dto.mensaje,
      traza: dto.traza ?? null,
      usuario: usuario ?? null,
    });
    return { codigoSeguimiento };
  }
}
