import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

/** Unidades de un formato en una ubicación. `activa` es falso si la ubicación o su bodega lo está. */
export interface StockEnUbicacion {
  id: number;
  codigo: string;
  bodega: string;
  activa: boolean;
  cantidad: number;
}

/** Proveedor y costo de la entrada más reciente del formato. */
export interface UltimaEntrada {
  fechaRecepcion: string;
  proveedor: { id: number; rut: string; razonSocial: string };
  costoUnitarioNeto: number;
}

/** El stock de un formato tal como lo ve el panel. */
export interface StockFormato {
  formato: {
    id: number;
    nombreFormato: string;
    sku: string;
    producto: string;
    activo: boolean;
  };
  ubicaciones: StockEnUbicacion[];
  total: number;
  ultimaEntrada: UltimaEntrada | null;
}

/**
 * Consulta de stock por formato y ubicación (E11-H5, RF-11.05, RF-11.12, RF-11.13). Solo lectura
 * desde PostgreSQL: el stock nunca se guarda en caché.
 */
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Stock del formato en cada ubicación con unidades (también las desactivadas: el stock físico
   * sigue ahí), su total y el proveedor y costo de la entrada de recepción más reciente. Un
   * formato desactivado también se consulta; uno inexistente responde 404.
   */
  async consultar(formatoId: number): Promise<StockFormato> {
    const formato = await this.prisma.formatoProducto.findUnique({
      where: { id: formatoId },
      select: {
        id: true,
        nombreFormato: true,
        articulo: { select: { sku: true, activo: true } },
        producto: { select: { nombre: true } },
        existencias: {
          where: { cantidad: { gt: 0 } },
          orderBy: [
            { ubicacion: { bodega: { nombre: 'asc' } } },
            { ubicacion: { codigo: 'asc' } },
            { ubicacionId: 'asc' },
          ],
          select: {
            cantidad: true,
            ubicacion: {
              select: {
                id: true,
                codigo: true,
                activa: true,
                bodega: { select: { nombre: true, activa: true } },
              },
            },
          },
        },
        // La fecha de recepción puede registrarse con atraso: manda ella, y entre entradas del
        // mismo día, la registrada después
        detallesEntrada: {
          orderBy: [
            { entrada: { fechaRecepcion: 'desc' } },
            { entrada: { id: 'desc' } },
          ],
          take: 1,
          select: {
            costoUnitarioNeto: true,
            entrada: {
              select: {
                fechaRecepcion: true,
                proveedor: {
                  select: { id: true, rut: true, razonSocial: true },
                },
              },
            },
          },
        },
      },
    });
    if (!formato) {
      throw new NotFoundException('El formato no existe.');
    }

    const ubicaciones = formato.existencias.map(({ cantidad, ubicacion }) => ({
      id: ubicacion.id,
      codigo: ubicacion.codigo,
      bodega: ubicacion.bodega.nombre,
      activa: ubicacion.activa && ubicacion.bodega.activa,
      cantidad,
    }));
    const [ultima] = formato.detallesEntrada;

    return {
      formato: {
        id: formato.id,
        nombreFormato: formato.nombreFormato,
        sku: formato.articulo.sku,
        producto: formato.producto.nombre,
        activo: formato.articulo.activo,
      },
      ubicaciones,
      total: ubicaciones.reduce((suma, u) => suma + u.cantidad, 0),
      ultimaEntrada: ultima
        ? {
            fechaRecepcion: ultima.entrada.fechaRecepcion
              .toISOString()
              .slice(0, 10),
            proveedor: ultima.entrada.proveedor,
            costoUnitarioNeto: ultima.costoUnitarioNeto.toNumber(),
          }
        : null,
    };
  }
}
