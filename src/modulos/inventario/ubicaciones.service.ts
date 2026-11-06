import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { UbicacionInventarioDto } from './dto/ubicacion-inventario.dto.js';

@Injectable()
export class UbicacionesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ubicaciones donde se puede guardar stock: las activas de bodegas activas (las mismas que
   * aceptan entradas, ajustes y transferencias), por bodega y código. Sirven también para
   * filtrar el inventario por bodega.
   */
  listarActivas(): Promise<UbicacionInventarioDto[]> {
    return this.prisma.ubicacion.findMany({
      where: { activa: true, bodega: { activa: true } },
      select: {
        id: true,
        codigo: true,
        bodega: { select: { id: true, nombre: true } },
      },
      orderBy: [
        { bodega: { nombre: 'asc' } },
        { bodegaId: 'asc' },
        { codigo: 'asc' },
        { id: 'asc' },
      ],
    });
  }
}
