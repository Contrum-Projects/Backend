import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { porcentaje } from '../../common/dominio/porcentajes.js';
import { ROLES_COMPRADOR } from '../../common/dominio/roles.js';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_CAMPANA,
  TIPOS_NOTIFICACION,
} from '../../common/dominio/valores.js';
import { CANDADOS, tomarCandado } from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ConfigurarCumpleanosDto } from './dto/configurar-cumpleanos.dto.js';
import {
  leerActivo,
  leerOferta,
  SALUDO_POR_DEFECTO,
  type SaludoCumpleanos,
  textoConfiguracion,
} from './saludo-cumpleanos.js';

/** Cifras de la tarjeta del saludo (SCRUM-150, SCRUM-141): las cuenta el backend. */
export interface CifrasCumpleanos {
  /**
   * Cuentas que cumplen años este mes (en Chile) y hoy recibirían el saludo: activas, con correo
   * verificado, que aceptan publicidad. Con el saludo apagado, 0: no hay nada programado.
   */
  programadosEsteMes: number;
  /**
   * Del mes calendario anterior (en Chile): porcentaje de los saludos enviados que se abrieron,
   * de 0 a 100 sin decimales. `null` si ese mes no se envió ninguno.
   */
  porcentajeAperturaUltimoMes: number | null;
}

export interface ConfiguracionCumpleanos
  extends SaludoCumpleanos, CifrasCumpleanos {
  /** `false` mientras el administrador no lo guarda: rige el saludo por defecto, sin oferta. */
  configurado: boolean;
}

const SELECCION = { asunto: true, cuerpo: true, segmento: true } as const;

type FilaSaludo = { asunto: string; cuerpo: string; segmento: string | null };

const saludoDe = (fila: FilaSaludo): SaludoCumpleanos => ({
  activo: leerActivo(fila.segmento),
  asunto: fila.asunto,
  cuerpo: fila.cuerpo,
  oferta: leerOferta(fila.segmento),
});

/**
 * Inicio del mes de `ahora` en Chile, desplazado en `meses`, como instante: AT TIME ZONE respeta el
 * cambio de horario.
 */
const inicioDeMes = (ahora: Date, meses: number) =>
  Prisma.sql`(date_trunc('month', ${ahora}::timestamptz AT TIME ZONE 'America/Santiago') + make_interval(months => ${meses}::int)) AT TIME ZONE 'America/Santiago'`;

/**
 * Configuración del saludo de cumpleaños (E12-H5, RF-12.10 y RF-12.11), en una sola fila de
 * CAMPANA con tipo `cumpleanos` (decisión del 5 de noviembre de 2026). Los saludos los envía
 * `SaludosCumpleanosService`; el correo lee esta configuración al enviarse.
 */
@Injectable()
export class CumpleanosService {
  constructor(private readonly prisma: PrismaService) {}

  async obtener(ahora = new Date()): Promise<ConfiguracionCumpleanos> {
    const fila = await this.prisma.campana.findFirst({
      where: { tipo: TIPOS_CAMPANA.CUMPLEANOS },
      orderBy: { id: 'asc' },
      select: SELECCION,
    });
    const saludo = fila ? saludoDe(fila) : SALUDO_POR_DEFECTO;
    return {
      ...saludo,
      ...(await this.cifras(saludo.activo, ahora)),
      configurado: fila !== null,
    };
  }

  /**
   * Guarda el saludo completo (reemplaza el anterior): si está activo, asunto, cuerpo y oferta. La
   * primera vez crea la fila, con quien la guarda como autor. Con el candado de la configuración:
   * dos guardados simultáneos no crean dos filas.
   */
  async configurar(
    dto: ConfigurarCumpleanosDto,
    codigoAutor: string,
    ahora = new Date(),
  ): Promise<ConfiguracionCumpleanos> {
    const segmento = textoConfiguracion({
      activo: dto.activo,
      oferta: { activa: dto.oferta.activa, texto: dto.oferta.texto ?? null },
    });
    const fila = await this.prisma.$transaction(async (tx) => {
      await tomarCandado(tx, CANDADOS.SALUDO_CUMPLEANOS);
      const actual = await tx.campana.findFirst({
        where: { tipo: TIPOS_CAMPANA.CUMPLEANOS },
        orderBy: { id: 'asc' },
        select: { id: true },
      });
      const datos = { asunto: dto.asunto, cuerpo: dto.cuerpo, segmento };
      if (actual) {
        return tx.campana.update({
          where: { id: actual.id },
          data: datos,
          select: SELECCION,
        });
      }
      const autor = await tx.usuario.findUnique({
        where: { codigoPublico: codigoAutor },
        select: { id: true },
      });
      if (!autor) throw new NotFoundException('La cuenta no existe.');
      return tx.campana.create({
        data: {
          ...datos,
          usuarioId: autor.id,
          tipo: TIPOS_CAMPANA.CUMPLEANOS,
        },
        select: SELECCION,
      });
    });
    const saludo = saludoDe(fila);
    return {
      ...saludo,
      ...(await this.cifras(saludo.activo, ahora)),
      configurado: true,
    };
  }

  private async cifras(
    activo: boolean,
    ahora: Date,
  ): Promise<CifrasCumpleanos> {
    const [programados, apertura] = await Promise.all([
      activo ? this.programadosDelMes(ahora) : Promise.resolve(0),
      this.aperturaDelMesAnterior(ahora),
    ]);
    return {
      programadosEsteMes: programados,
      porcentajeAperturaUltimoMes: apertura,
    };
  }

  /** Mismas condiciones que el envío (`SaludosCumpleanosService`), con el mes en vez del día. */
  private async programadosDelMes(ahora: Date): Promise<number> {
    const [fila] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS "total"
      FROM usuario u
      WHERE u.activo
        AND u.rol = ANY(${[...ROLES_COMPRADOR]}::text[])
        AND u.acepta_marketing_email
        AND u.fecha_verificacion_correo IS NOT NULL
        AND u.fecha_nacimiento IS NOT NULL
        AND to_char(u.fecha_nacimiento, 'MM') =
            to_char(${ahora}::timestamptz AT TIME ZONE 'America/Santiago', 'MM')`;
    return Number(fila?.total ?? 0n);
  }

  private async aperturaDelMesAnterior(ahora: Date): Promise<number | null> {
    const [fila] = await this.prisma.$queryRaw<
      { enviados: bigint; abiertos: bigint }[]
    >`
      SELECT COUNT(*) AS "enviados",
             COUNT(fecha_apertura) AS "abiertos"
      FROM notificacion
      WHERE tipo = ${TIPOS_NOTIFICACION.CUMPLEANOS}
        AND estado_envio = ${ESTADOS_NOTIFICACION.ENVIADA}
        AND fecha_creacion >= ${inicioDeMes(ahora, -1)}
        AND fecha_creacion < ${inicioDeMes(ahora, 0)}`;
    return porcentaje(
      Number(fila?.abiertos ?? 0n),
      Number(fila?.enviados ?? 0n),
    );
  }
}
