import { Injectable, NotFoundException } from '@nestjs/common';
import { TIPOS_CAMPANA } from '../../common/dominio/valores.js';
import { CANDADOS, tomarCandado } from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ConfigurarCumpleanosDto } from './dto/configurar-cumpleanos.dto.js';
import {
  leerOferta,
  SALUDO_POR_DEFECTO,
  type SaludoCumpleanos,
  textoOferta,
} from './saludo-cumpleanos.js';

export interface ConfiguracionCumpleanos extends SaludoCumpleanos {
  /** `false` mientras el administrador no lo guarda: rige el saludo por defecto, sin oferta. */
  configurado: boolean;
}

const SELECCION = { asunto: true, cuerpo: true, segmento: true } as const;

const aRespuesta = (fila: {
  asunto: string;
  cuerpo: string;
  segmento: string | null;
}): ConfiguracionCumpleanos => ({
  asunto: fila.asunto,
  cuerpo: fila.cuerpo,
  oferta: leerOferta(fila.segmento),
  configurado: true,
});

/**
 * Configuración del saludo de cumpleaños (E12-H5, RF-12.10 y RF-12.11), en una sola fila de
 * CAMPANA con tipo `cumpleanos` (decisión del 5 de noviembre de 2026). Los saludos los envía
 * `SaludosCumpleanosService`; el correo lee esta configuración al enviarse.
 */
@Injectable()
export class CumpleanosService {
  constructor(private readonly prisma: PrismaService) {}

  async obtener(): Promise<ConfiguracionCumpleanos> {
    const fila = await this.prisma.campana.findFirst({
      where: { tipo: TIPOS_CAMPANA.CUMPLEANOS },
      orderBy: { id: 'asc' },
      select: SELECCION,
    });
    return fila
      ? aRespuesta(fila)
      : { ...SALUDO_POR_DEFECTO, configurado: false };
  }

  /**
   * Guarda el saludo completo (reemplaza el anterior). La primera vez crea la fila, con quien la
   * guarda como autor. Con el candado de la configuración: dos guardados simultáneos no crean dos
   * filas.
   */
  async configurar(
    dto: ConfigurarCumpleanosDto,
    codigoAutor: string,
  ): Promise<ConfiguracionCumpleanos> {
    const segmento = textoOferta({
      activa: dto.oferta.activa,
      texto: dto.oferta.texto ?? null,
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
    return aRespuesta(fila);
  }
}
