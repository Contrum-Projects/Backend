import { BadRequestException, Injectable } from '@nestjs/common';
import { hoyEnLaTienda } from '../../common/dominio/fechas.js';
import {
  ESTADOS_SIN_VENTA,
  TIPOS_NOTIFICACION,
} from '../../common/dominio/valores.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { porcentaje } from '../../common/dominio/porcentajes.js';
import {
  DIAS_PARA_RECUPERAR,
  type EventoCuenta,
  seriesAbandono,
} from './series-abandono.js';

/** Largo máximo del período, en meses, contando ambos extremos (decisión del 6 nov 2026). */
export const MAXIMO_MESES_REPORTE_CARRITOS = 24;

export interface CarritosDelMes {
  /** AAAA-MM, en hora de Chile. */
  mes: string;
  abandonados: number;
  /** De los abandonados ese mes, cuántos terminaron en una compra pagada. */
  recuperados: number;
  /** Recuperados sobre abandonados, de 0 a 100 al entero; `null` sin abandonos (SCRUM-150). */
  porcentajeRecuperados: number | null;
}

export interface ReporteCarritos {
  desde: string;
  hasta: string;
  meses: CarritosDelMes[];
  total: {
    abandonados: number;
    recuperados: number;
    porcentajeRecuperados: number | null;
  };
}

/** AAAA-MM → número de mes contado desde el año 0, para comparar y recorrer meses. */
const indiceMes = (mes: string): number => {
  const [anio, numero] = mes.split('-').map(Number);
  return (anio ?? 0) * 12 + (numero ?? 1) - 1;
};

const deIndiceMes = (indice: number): string =>
  `${String(Math.floor(indice / 12)).padStart(4, '0')}-${String((indice % 12) + 1).padStart(2, '0')}`;

/** Mes (AAAA-MM) de ese instante en hora de Chile. */
const mesEnLaTienda = (fecha: Date): string => hoyEnLaTienda(fecha).slice(0, 7);

@Injectable()
export class ReporteCarritosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * E14-H3 · Carritos abandonados y recuperados por mes (RF-14.04). Un abandono es una serie de
   * recordatorios de E12-H4 y cuenta en el mes de Chile en que salió su primer recordatorio, en
   * cualquier estado del correo: el carrito se abandonó aunque el correo se cancelara. Se recupera
   * con un pedido pagado de la misma cuenta (todo estado salvo `ESTADOS_SIN_VENTA`) dentro de
   * `DIAS_PARA_RECUPERAR` días y antes de la serie siguiente; cuenta en el mes del abandono. Los
   * meses sin abandonos salen en cero. Se calcula al consultar, sin caché.
   */
  async carritosPorMes(desde: string, hasta: string): Promise<ReporteCarritos> {
    const primero = indiceMes(desde);
    const ultimo = indiceMes(hasta);
    this.validarPeriodo(primero, ultimo);

    const { recordatorios, compras } = await this.leerEventos(desde, hasta);
    const meses = new Map<string, CarritosDelMes>();
    for (let indice = primero; indice <= ultimo; indice++) {
      const mes = deIndiceMes(indice);
      meses.set(mes, {
        mes,
        abandonados: 0,
        recuperados: 0,
        porcentajeRecuperados: null,
      });
    }
    for (const serie of seriesAbandono(recordatorios, compras)) {
      const fila = meses.get(mesEnLaTienda(serie.inicio));
      if (!fila) continue;
      fila.abandonados += 1;
      if (serie.recuperada) fila.recuperados += 1;
    }

    const lista = [...meses.values()].map((fila) => ({
      ...fila,
      porcentajeRecuperados: porcentaje(fila.recuperados, fila.abandonados),
    }));
    const abandonados = lista.reduce(
      (suma, fila) => suma + fila.abandonados,
      0,
    );
    const recuperados = lista.reduce(
      (suma, fila) => suma + fila.recuperados,
      0,
    );
    return {
      desde,
      hasta,
      meses: lista,
      total: {
        abandonados,
        recuperados,
        porcentajeRecuperados: porcentaje(recuperados, abandonados),
      },
    };
  }

  /**
   * Recordatorios y compras de las cuentas con algún recordatorio en el período. Los recordatorios
   * se leen desde el primero de cada cuenta: para saber si uno abre serie hay que conocer la serie
   * anterior, aunque sea de un mes fuera del período. Las compras, hasta `DIAS_PARA_RECUPERAR`
   * días después del período, para las series de sus últimos días. Los meses se cortan a
   * medianoche de Chile: AT TIME ZONE respeta el cambio de horario.
   */
  private async leerEventos(
    desde: string,
    hasta: string,
  ): Promise<{ recordatorios: EventoCuenta[]; compras: EventoCuenta[] }> {
    const tipo = TIPOS_NOTIFICACION.RECORDATORIO_CARRITO;
    const primerDia = `${desde}-01`;
    const primerDiaUltimoMes = `${hasta}-01`;
    const inicio = Prisma.sql`(${primerDia}::date)::timestamp AT TIME ZONE 'America/Santiago'`;
    const fin = Prisma.sql`(${primerDiaUltimoMes}::date + interval '1 month') AT TIME ZONE 'America/Santiago'`;
    const cuentas = Prisma.sql`
      WITH cuentas AS (
        SELECT DISTINCT n.id_usuario FROM notificacion n
        WHERE n.tipo = ${tipo}
          AND n.id_usuario IS NOT NULL
          AND n.fecha_creacion >= ${inicio}
          AND n.fecha_creacion < ${fin}
      )`;
    const [recordatorios, compras] = await Promise.all([
      this.prisma.$queryRaw<EventoCuenta[]>`
        ${cuentas}
        SELECT n.id_usuario AS "usuarioId", n.fecha_creacion AS "fecha"
        FROM notificacion n
        JOIN cuentas c ON c.id_usuario = n.id_usuario
        WHERE n.tipo = ${tipo} AND n.fecha_creacion < ${fin}`,
      this.prisma.$queryRaw<EventoCuenta[]>`
        ${cuentas}
        SELECT p.id_usuario AS "usuarioId", p.fecha_pedido AS "fecha"
        FROM pedido p
        JOIN cuentas c ON c.id_usuario = p.id_usuario
        WHERE p.estado_actual <> ALL(${ESTADOS_SIN_VENTA}::text[])
          AND p.fecha_pedido >= ${inicio}
          AND p.fecha_pedido < ${fin} + make_interval(days => ${DIAS_PARA_RECUPERAR}::int)`,
    ]);
    return { recordatorios, compras };
  }

  private validarPeriodo(primero: number, ultimo: number): void {
    if (ultimo < primero) {
      throw new BadRequestException(
        'El mes hasta no puede ser anterior al mes desde.',
      );
    }
    if (ultimo - primero + 1 > MAXIMO_MESES_REPORTE_CARRITOS) {
      throw new BadRequestException(
        `El período no puede superar los ${MAXIMO_MESES_REPORTE_CARRITOS} meses.`,
      );
    }
  }
}
