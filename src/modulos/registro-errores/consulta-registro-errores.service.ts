import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  diaSiguiente,
  inicioDelDiaEnLaTienda,
} from '../../common/dominio/fechas.js';
import { ORIGENES_ERROR } from '../../common/dominio/valores.js';
import { errorDeCampo } from '../../common/errores/error-de-campo.js';
import { POR_PAGINA } from '../../common/validacion/paginacion.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ListarRegistroErroresDto } from './dto/listar-registro-errores.dto.js';
import type {
  ListadoRegistroErroresDto,
  RegistroErrorDto,
} from './dto/registro-error-respuesta.dto.js';
import type { OrigenError } from './registro-errores.service.js';

/**
 * Días que se guarda cada error (SCRUM-168, decisión del 20 nov 2026): alcanza para revisar lo
 * que pasó en el último sprint y en la presentación siguiente, y evita que la tabla crezca sin fin.
 */
export const DIAS_RETENCION_REGISTRO_ERRORES = 90;

const DIA_MS = 24 * 60 * 60 * 1000;

const SELECCION = {
  codigoSeguimiento: true,
  fechaHora: true,
  origen: true,
  componente: true,
  metodo: true,
  ruta: true,
  estadoHttp: true,
  tipoError: true,
  mensaje: true,
  traza: true,
  usuario: {
    select: { codigoPublico: true, nombre: true, apellido: true, email: true },
  },
} satisfies Prisma.RegistroErrorSelect;

type Fila = Prisma.RegistroErrorGetPayload<{ select: typeof SELECCION }>;

const aRegistro = ({ usuario, origen, ...fila }: Fila): RegistroErrorDto => ({
  ...fila,
  origen: origen as OrigenError,
  cuenta: usuario
    ? {
        codigoPublico: usuario.codigoPublico,
        nombre: `${usuario.nombre} ${usuario.apellido}`,
        email: usuario.email,
      }
    : null,
});

/** Consulta y limpieza del registro de errores para el panel (SCRUM-168). */
@Injectable()
export class ConsultaRegistroErroresService {
  private readonly logger = new Logger(ConsultaRegistroErroresService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Más recientes primero; las fechas van en hora de Chile y `hasta` se incluye entero. */
  async listar(
    filtros: ListarRegistroErroresDto,
  ): Promise<ListadoRegistroErroresDto> {
    if (filtros.desde && filtros.hasta && filtros.hasta < filtros.desde) {
      throw errorDeCampo(
        BadRequestException,
        'La fecha hasta no puede ser anterior a la fecha desde.',
        'hasta',
      );
    }
    const pagina = filtros.pagina ?? 1;
    const limite = filtros.limite ?? POR_PAGINA;
    const sinOrigen: Prisma.RegistroErrorWhereInput = {
      AND: [
        filtros.desde
          ? { fechaHora: { gte: inicioDelDiaEnLaTienda(filtros.desde) } }
          : {},
        filtros.hasta
          ? {
              fechaHora: {
                lt: inicioDelDiaEnLaTienda(diaSiguiente(filtros.hasta)),
              },
            }
          : {},
        filtros.buscar
          ? {
              OR: [
                {
                  codigoSeguimiento: {
                    startsWith: filtros.buscar,
                    mode: 'insensitive',
                  },
                },
                {
                  componente: { contains: filtros.buscar, mode: 'insensitive' },
                },
                { mensaje: { contains: filtros.buscar, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
    };
    const where: Prisma.RegistroErrorWhereInput = {
      AND: [sinOrigen, filtros.origen ? { origen: filtros.origen } : {}],
    };
    const deOrigen = (origen: OrigenError) =>
      this.prisma.registroError.count({
        where: { AND: [sinOrigen, { origen }] },
      });

    const [filas, total, todos, api, navegador, servidorWeb] =
      await this.prisma.$transaction([
        this.prisma.registroError.findMany({
          where,
          select: SELECCION,
          orderBy: [{ fechaHora: 'desc' }, { id: 'desc' }],
          skip: (pagina - 1) * limite,
          take: limite,
        }),
        this.prisma.registroError.count({ where }),
        this.prisma.registroError.count({ where: sinOrigen }),
        deOrigen(ORIGENES_ERROR.API),
        deOrigen(ORIGENES_ERROR.NAVEGADOR),
        deOrigen(ORIGENES_ERROR.SERVIDOR_WEB),
      ]);

    return {
      items: filas.map(aRegistro),
      total,
      pagina,
      limite,
      conteos: { todos, api, navegador, servidorWeb },
      diasRetencion: DIAS_RETENCION_REGISTRO_ERRORES,
    };
  }

  /** Borra los errores con más de `DIAS_RETENCION_REGISTRO_ERRORES` días. Idempotente. */
  async eliminarAntiguos(ahora = new Date()): Promise<number> {
    const limite = new Date(
      ahora.getTime() - DIAS_RETENCION_REGISTRO_ERRORES * DIA_MS,
    );
    const { count } = await this.prisma.registroError.deleteMany({
      where: { fechaHora: { lt: limite } },
    });
    if (count > 0) {
      this.logger.log(`Se borraron ${count} errores antiguos del registro.`);
    }
    return count;
  }
}
