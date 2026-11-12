import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { CANDADOS, tomarCandado } from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CacheCatalogo, CLAVES_CACHE } from './cache-catalogo.js';
import type { ActualizarCategoriaDto } from './dto/actualizar-categoria.dto.js';
import type { CrearCategoriaDto } from './dto/crear-categoria.dto.js';
import { errorDeCampo } from '../../common/errores/error-de-campo.js';
import { TIPOS_DESTINO_PORTADA } from '../../common/dominio/valores.js';
import {
  contarEnPortada,
  exigirSinUsos,
  traducirUsoSimultaneo,
} from './usos-catalogo.js';

export interface NodoCategoria {
  id: number;
  nombre: string;
  descripcion: string | null;
  padreId: number | null;
  subcategorias: NodoCategoria[];
}

@Injectable()
export class CategoriasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheCatalogo,
  ) {}

  /**
   * Crea una categoría o, si llega `padreId`, una subcategoría dentro de ella
   * (E3-H4, RF-03.06). Una categoría nueva no tiene hijos, así que no puede formar un ciclo.
   * Después de guardarla invalida el árbol de la tienda (E2-H1).
   */
  async crear(dto: CrearCategoriaDto) {
    if (dto.padreId !== undefined) {
      const padre = await this.prisma.categoria.findUnique({
        where: { id: dto.padreId },
        select: { id: true },
      });
      if (!padre) {
        throw errorDeCampo(
          NotFoundException,
          'La categoría padre no existe.',
          'padreId',
        );
      }
    }
    const categoria = await this.prisma.categoria.create({
      data: {
        nombre: dto.nombre,
        descripcion: dto.descripcion,
        padreId: dto.padreId,
      },
    });
    await this.cache.invalidar(CLAVES_CACHE.CATEGORIAS);
    return categoria;
  }

  /**
   * Cambia el nombre, la descripción o el padre de una categoría (E3-H4).
   * Mover una categoría dentro de ella misma o de una de sus subcategorías formaría un
   * ciclo («Categorías sin ciclos»): se rechaza. Todos los cambios de estructura toman
   * el mismo bloqueo de transacción, de modo que dos movimientos simultáneos no pueden
   * crear juntos un ciclo que cada uno, por separado, no formaría. Después del commit
   * invalida el árbol de la tienda (E2-H1).
   */
  async actualizar(id: number, dto: ActualizarCategoriaDto) {
    if (
      dto.nombre === undefined &&
      dto.descripcion === undefined &&
      dto.padreId === undefined
    ) {
      throw new BadRequestException('Indica al menos un campo para cambiar.');
    }
    const actualizada = await this.prisma.$transaction(async (tx) => {
      await tomarCandado(tx, CANDADOS.CATEGORIAS);
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
    await this.cache.invalidar(CLAVES_CACHE.CATEGORIAS);
    return actualizada;
  }

  /**
   * Borra una categoría que ya no se usa (SCRUM-158): sin productos, subcategorías, cupones ni
   * imágenes de la portada. Si se usa, 409 con dónde. Toma el bloqueo de la estructura del árbol
   * (así no se le agrega una subcategoría mientras se borra) y después del commit invalida el
   * árbol de la tienda.
   */
  async eliminar(id: number): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tomarCandado(tx, CANDADOS.CATEGORIAS);
        const categoria = await tx.categoria.findUnique({
          where: { id },
          select: { id: true },
        });
        if (!categoria) {
          throw new NotFoundException('La categoría no existe.');
        }
        const [productos, subcategorias, cupones, portada] = await Promise.all([
          tx.producto.count({ where: { categoriaId: id } }),
          tx.categoria.count({ where: { padreId: id } }),
          tx.cuponCategoria.count({ where: { categoriaId: id } }),
          contarEnPortada(tx, TIPOS_DESTINO_PORTADA.CATEGORIA, id),
        ]);
        exigirSinUsos(
          { productos, subcategorias, cupones, portada },
          'categoría',
        );
        await tx.categoria.delete({ where: { id } });
      });
    } catch (error) {
      throw traducirUsoSimultaneo(error, 'categoría');
    }
    await this.cache.invalidar(CLAVES_CACHE.CATEGORIAS);
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
        throw errorDeCampo(
          ConflictException,
          'No se puede mover una categoría dentro de sí misma ni de una de sus subcategorías: formaría un ciclo.',
          'padreId',
        );
      }
      visitadas.add(actual);
      const fila: { padreId: number | null } | null =
        await tx.categoria.findUnique({
          where: { id: actual },
          select: { padreId: true },
        });
      if (!fila) {
        throw errorDeCampo(
          NotFoundException,
          'La categoría padre no existe.',
          'padreId',
        );
      }
      actual = fila.padreId;
    }
  }
}
