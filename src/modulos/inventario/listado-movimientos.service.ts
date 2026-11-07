import { BadRequestException, Injectable } from '@nestjs/common';
import {
  TIPOS_MOVIMIENTO,
  TIPOS_POR_GRUPO_MOVIMIENTO,
} from '../../common/dominio/valores.js';
import { errorDeCampo } from '../../common/errores/error-de-campo.js';
import { POR_PAGINA } from '../../common/validacion/paginacion.js';
import { escaparComodines } from '../../common/validacion/texto-busqueda.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ListarMovimientosDto } from './dto/listar-movimientos.dto.js';
import type {
  ListadoMovimientosDto,
  MovimientoListadoDto,
  UbicacionResumenDto,
} from './dto/movimiento-listado.dto.js';

/** Los registra el sistema al vender o cancelar un pedido: no los firma el personal. */
const DEL_SISTEMA: string[] = [
  TIPOS_MOVIMIENTO.VENTA,
  TIPOS_MOVIMIENTO.REINGRESO,
];

const SELECCION_UBICACION = {
  select: { id: true, codigo: true, bodega: { select: { nombre: true } } },
} as const;

type FilaUbicacion = { id: number; codigo: string; bodega: { nombre: string } };

const resumen = (ubicacion: FilaUbicacion): UbicacionResumenDto => ({
  id: ubicacion.id,
  codigo: ubicacion.codigo,
  bodega: ubicacion.bodega.nombre,
});

/**
 * Movimientos de inventario del panel (E11-H5 criterio 2, SCRUM-150), del más reciente al más
 * antiguo. Solo lectura desde PostgreSQL.
 */
@Injectable()
export class ListadoMovimientosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(filtros: ListarMovimientosDto): Promise<ListadoMovimientosDto> {
    if (filtros.desde && filtros.hasta && filtros.hasta < filtros.desde) {
      throw errorDeCampo(
        BadRequestException,
        'La fecha hasta no puede ser anterior a la fecha desde.',
        'hasta',
      );
    }
    const pagina = filtros.pagina ?? 1;
    const limite = filtros.limite ?? POR_PAGINA;
    const where = this.condiciones(filtros);

    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*)::bigint AS total FROM movimiento_inventario m ${where}`;
    const ids = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT m.id_movimiento AS id FROM movimiento_inventario m ${where}
      ORDER BY m.fecha_hora DESC, m.id_movimiento DESC
      LIMIT ${limite} OFFSET ${(pagina - 1) * limite}`;

    return {
      items: await this.detalle(ids.map((fila) => fila.id)),
      total: Number(total),
      pagina,
      limite,
    };
  }

  /** El `WHERE` de los filtros; los días van en hora de Chile y `hasta` se incluye entero. */
  private condiciones({
    bodegaId,
    grupo,
    desde,
    hasta,
    buscar,
  }: ListarMovimientosDto) {
    const partes: Prisma.Sql[] = [];
    if (bodegaId) {
      partes.push(Prisma.sql`EXISTS (
        SELECT 1 FROM ubicacion u
        WHERE u.id_bodega = ${bodegaId}
          AND u.id_ubicacion IN (m.id_ubicacion_origen, m.id_ubicacion_destino))`);
    }
    if (grupo) {
      partes.push(
        Prisma.sql`m.tipo IN (${Prisma.join([...TIPOS_POR_GRUPO_MOVIMIENTO[grupo]])})`,
      );
    }
    if (desde) {
      partes.push(
        Prisma.sql`m.fecha_hora >= (${desde}::date)::timestamp AT TIME ZONE 'America/Santiago'`,
      );
    }
    if (hasta) {
      partes.push(
        Prisma.sql`m.fecha_hora < (${hasta}::date + 1)::timestamp AT TIME ZONE 'America/Santiago'`,
      );
    }
    if (buscar) {
      const texto = `%${escaparComodines(buscar)}%`;
      partes.push(Prisma.sql`EXISTS (
        SELECT 1 FROM formato_producto f
        JOIN producto p ON p.id_producto = f.id_producto
        LEFT JOIN entrada_inventario e ON e.id_entrada = m.id_entrada
        LEFT JOIN pedido pe ON pe.id_pedido = m.id_pedido
        WHERE f.id_formato = m.id_formato
          AND (p.nombre ILIKE ${texto} OR f.nombre_formato ILIKE ${texto}
            OR e.numero_documento_proveedor ILIKE ${texto}
            OR pe.codigo_publico ILIKE ${texto} OR m.observacion ILIKE ${texto}))`);
    }
    return partes.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(partes, ' AND ')}`
      : Prisma.empty;
  }

  /** Arma cada movimiento de la página en su orden. */
  private async detalle(ids: number[]): Promise<MovimientoListadoDto[]> {
    if (ids.length === 0) {
      return [];
    }
    const filas = await this.prisma.movimientoInventario.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        fechaHora: true,
        tipo: true,
        cantidad: true,
        observacion: true,
        formato: {
          select: {
            id: true,
            nombreFormato: true,
            producto: { select: { nombre: true } },
          },
        },
        ubicacionOrigen: SELECCION_UBICACION,
        ubicacionDestino: SELECCION_UBICACION,
        entrada: { select: { numeroDocumentoProveedor: true } },
        pedido: { select: { codigoPublico: true } },
        usuario: { select: { nombre: true, apellido: true } },
      },
    });
    const porId = new Map(filas.map((fila) => [fila.id, fila]));

    return ids.flatMap((id) => {
      const fila = porId.get(id);
      // Todo movimiento tiene al menos una ubicación (origen, destino o las dos)
      const ubicacion = fila?.ubicacionOrigen ?? fila?.ubicacionDestino;
      if (!fila || !ubicacion) {
        return [];
      }
      const transferencia = fila.tipo === TIPOS_MOVIMIENTO.TRANSFERENCIA;
      // Sale de una ubicación sin llegar a otra: resta stock
      const resta = fila.ubicacionOrigen !== null && !transferencia;
      return [
        {
          id: fila.id,
          fechaHora: fila.fechaHora.toISOString(),
          tipo: fila.tipo as MovimientoListadoDto['tipo'],
          formato: {
            id: fila.formato.id,
            producto: fila.formato.producto.nombre,
            nombreFormato: fila.formato.nombreFormato,
          },
          cantidad: resta ? -fila.cantidad : fila.cantidad,
          ubicacion: resumen(ubicacion),
          destino:
            transferencia && fila.ubicacionDestino
              ? resumen(fila.ubicacionDestino)
              : null,
          referencia:
            fila.entrada?.numeroDocumentoProveedor ??
            fila.pedido?.codigoPublico ??
            fila.observacion ??
            null,
          registradoPor:
            fila.usuario && !DEL_SISTEMA.includes(fila.tipo)
              ? { nombre: `${fila.usuario.nombre} ${fila.usuario.apellido}` }
              : null,
        },
      ];
    });
  }
}
