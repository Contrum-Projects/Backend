import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { CategoriasService } from './categorias.service.js';

/** Categorías de prueba como `[id, padreId]`: 1 > 2 > 3 y 4 es otra raíz. */
const PADRES = new Map<number, number | null>([
  [1, null],
  [2, 1],
  [3, 2],
  [4, null],
]);

const crearPrisma = () => {
  const buscar = vi.fn(({ where }: { where: { id: number } }) =>
    Promise.resolve(
      PADRES.has(where.id)
        ? { id: where.id, padreId: PADRES.get(where.id) }
        : null,
    ),
  );
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    categoria: {
      findUnique: buscar,
      update: vi.fn().mockResolvedValue({ id: 1 }),
    },
  };
  return {
    tx,
    categoria: {
      findUnique: buscar,
      create: vi.fn().mockResolvedValue({ id: 10 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn((funcion: (cliente: typeof tx) => unknown) =>
      funcion(tx),
    ),
  };
};

describe('CategoriasService', () => {
  let prisma: ReturnType<typeof crearPrisma>;
  let servicio: CategoriasService;

  beforeEach(() => {
    prisma = crearPrisma();
    servicio = new CategoriasService(prisma as unknown as PrismaService);
  });

  describe('crear', () => {
    it('E3-H4 · subcategoría creada: la guarda dentro de la categoría existente', async () => {
      await servicio.crear({ nombre: 'Shampoos', padreId: 1 });

      expect(prisma.categoria.create).toHaveBeenCalledWith({
        data: { nombre: 'Shampoos', descripcion: undefined, padreId: 1 },
      });
    });

    it('sin padreId crea una categoría raíz', async () => {
      await servicio.crear({ nombre: 'Tratamientos' });

      expect(prisma.categoria.create).toHaveBeenCalledWith({
        data: {
          nombre: 'Tratamientos',
          descripcion: undefined,
          padreId: undefined,
        },
      });
    });

    it('rechaza con 404 una categoría padre que no existe', async () => {
      await expect(
        servicio.crear({ nombre: 'Shampoos', padreId: 99 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.categoria.create).not.toHaveBeenCalled();
    });
  });

  describe('actualizar', () => {
    it('E3-H4 · ciclo de categorías: rechaza mover una categoría dentro de una de sus subcategorías', async () => {
      // 3 es nieta de 1: mover 1 dentro de 3 formaría un ciclo
      await expect(
        servicio.actualizar(1, { padreId: 3 }),
      ).rejects.toBeInstanceOf(ConflictException);
      // 2 es hija directa de 1
      await expect(
        servicio.actualizar(1, { padreId: 2 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.tx.categoria.update).not.toHaveBeenCalled();
    });

    it('rechaza mover una categoría dentro de sí misma', async () => {
      await expect(
        servicio.actualizar(2, { padreId: 2 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.tx.categoria.update).not.toHaveBeenCalled();
    });

    it('permite mover una categoría a otra rama sin relación', async () => {
      await servicio.actualizar(2, { padreId: 4 });

      expect(prisma.tx.categoria.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: { nombre: undefined, descripcion: undefined, padreId: 4 },
      });
    });

    it('permite mover una subcategoría a su abuela y dejar una categoría como raíz con null', async () => {
      await servicio.actualizar(3, { padreId: 1 });
      await servicio.actualizar(3, { padreId: null });

      expect(prisma.tx.categoria.update).toHaveBeenCalledTimes(2);
      expect(prisma.tx.categoria.update).toHaveBeenLastCalledWith({
        where: { id: 3 },
        data: { nombre: undefined, descripcion: undefined, padreId: null },
      });
    });

    it('toma el bloqueo de estructura antes de revisar el ciclo', async () => {
      await servicio.actualizar(2, { padreId: 4 });

      const ordenBloqueo = prisma.tx.$executeRaw.mock.invocationCallOrder[0]!;
      const ordenBusqueda =
        prisma.tx.categoria.findUnique.mock.invocationCallOrder[0]!;
      expect(ordenBloqueo).toBeLessThan(ordenBusqueda);
    });

    it('rechaza con 404 una categoría o un padre que no existen', async () => {
      await expect(
        servicio.actualizar(99, { nombre: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        servicio.actualizar(1, { padreId: 99 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rechaza con 400 un cambio sin ningún campo', async () => {
      await expect(servicio.actualizar(1, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('cambiar solo el nombre no revisa ciclos', async () => {
      await servicio.actualizar(1, { nombre: 'Cuidado capilar' });

      expect(prisma.tx.categoria.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          nombre: 'Cuidado capilar',
          descripcion: undefined,
          padreId: undefined,
        },
      });
    });
  });

  describe('listarArbol', () => {
    it('E3-H4 · subcategoría creada: la muestra bajo su categoría', async () => {
      prisma.categoria.findMany.mockResolvedValue([
        { id: 2, nombre: 'Shampoos', descripcion: null, padreId: 1 },
        { id: 1, nombre: 'Cuidado', descripcion: null, padreId: null },
        { id: 3, nombre: 'Sin sulfatos', descripcion: null, padreId: 2 },
        { id: 4, nombre: 'Color', descripcion: 'Tintes', padreId: null },
      ]);

      const arbol = await servicio.listarArbol();

      expect(arbol.map((nodo) => nodo.id)).toEqual([1, 4]);
      expect(arbol[0]!.subcategorias.map((nodo) => nodo.id)).toEqual([2]);
      expect(
        arbol[0]!.subcategorias[0]!.subcategorias.map((nodo) => nodo.id),
      ).toEqual([3]);
      expect(arbol[1]!.subcategorias).toEqual([]);
    });
  });
});
