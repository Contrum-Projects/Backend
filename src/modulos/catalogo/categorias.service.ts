import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ActualizarCategoriaDto } from './dto/actualizar-categoria.dto.js';
import type { CrearCategoriaDto } from './dto/crear-categoria.dto.js';

export interface NodoCategoria {
  id: number;
  nombre: string;
  descripcion: string | null;
  padreId: number | null;
  subcategorias: NodoCategoria[];
}

@Injectable()
export class CategoriasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea una categoría o, si llega `padreId`, una subcategoría dentro de ella
   * (E3-H4, RF-03.06). Una categoría nueva no tiene hijos, así que no puede formar un ciclo.
   */
  async crear(dto: CrearCategoriaDto) {
    if (dto.padreId !== undefined) {
      const padre = await this.prisma.categoria.findUnique({
        where: { id: dto.padreId },
        select: { id: true },
      });
      if (!padre) {
        throw new NotFoundException('La categoría padre no existe.');
      }
    }
    return this.prisma.categoria.create({
      data: {
        nombre: dto.nombre,
        descripcion: dto.descripcion,
        padreId: dto.padreId,
      },
    });
  }

  /**
   * Cambia el nombre, la descripción o el padre de una categoría (E3-H4).
   * Mover una categoría dentro de ella misma o de una de sus subcategorías formaría un
   * ciclo («Categorías sin ciclos»): se rechaza. Todos los cambios de estructura toman
   * el mismo bloqueo de transacción, de modo que dos movimientos simultáneos no pueden
   * crear juntos un ciclo que cada uno, por separado, no formaría.
   */
  async actualizar(id: number, dto: ActualizarCategoriaDto) {
    if (
      dto.nombre === undefined &&
      dto.descripcion === undefined &&
      dto.padreId === undefined
    ) {
      throw new BadRequestException('Indica al menos un campo para cambiar.');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(3402)`;
      const categoria = await tx.categoria.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!categoria) {
        throw new NotFoundException('La categoría no existe.');
      }
      if (dto.padreId !== undefined && dto.padreId !== null) {
        await this.exigirPadreSinCiclo(tx, id, dto.padreId);
      }
      return tx.categoria.update({
        where: { id },
        data: {
          nombre: dto.nombre,
          descripcion: dto.descripcion,
          padreId: dto.padreId,
        },
      });
    });
  }

  /** Árbol de categorías con sus subcategorías anidadas, ordenadas por nombre. */
  async listarArbol(): Promise<NodoCategoria[]> {
    const filas = await this.prisma.categoria.findMany({
      select: { id: true, nombre: true, descripcion: true, padreId: true },
      orderBy: { nombre: 'asc' },
    });
    const nodos = new Map<number, NodoCategoria>(
      filas.map((fila) => [fila.id, { ...fila, subcategorias: [] }]),
    );
    const raices: NodoCategoria[] = [];
    for (const nodo of nodos.values()) {
      const padre = nodo.padreId === null ? undefined : nodos.get(nodo.padreId);
      (padre ? padre.subcategorias : raices).push(nodo);
    }
    return raices;
  }

  /**
   * Sube desde el padre elegido hasta la raíz: si pasa por la categoría que se mueve,
   * el padre es ella misma o una de sus subcategorías y el cambio formaría un ciclo.
   */
  private async exigirPadreSinCiclo(
    tx: Prisma.TransactionClient,
    id: number,
    padreId: number,
  ) {
    const visitadas = new Set<number>();
    let actual: number | null = padreId;
    while (actual !== null && !visitadas.has(actual)) {
      if (actual === id) {
        throw new ConflictException(
          'No se puede mover una categoría dentro de sí misma ni de una de sus subcategorías: formaría un ciclo.',
        );
      }
      visitadas.add(actual);
      const fila: { padreId: number | null } | null =
        await tx.categoria.findUnique({
          where: { id: actual },
          select: { padreId: true },
        });
      if (!fila) {
        throw new NotFoundException('La categoría padre no existe.');
      }
      actual = fila.padreId;
    }
  }
}
