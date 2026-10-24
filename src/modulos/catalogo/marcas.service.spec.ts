import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CacheCatalogo } from './cache-catalogo.js';
import { MarcasService } from './marcas.service.js';

const crearPrisma = () => {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    marca: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi
        .fn()
        .mockResolvedValue({ id: 1, nombre: 'Kerastase', activa: true }),
    },
  };
  return {
    tx,
    marca: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn((funcion: (cliente: typeof tx) => unknown) =>
      funcion(tx),
    ),
  };
};

describe('MarcasService', () => {
  let prisma: ReturnType<typeof crearPrisma>;
  let cache: { invalidar: ReturnType<typeof vi.fn> };
  let servicio: MarcasService;

  beforeEach(() => {
    prisma = crearPrisma();
    cache = { invalidar: vi.fn().mockResolvedValue(undefined) };
    servicio = new MarcasService(
      prisma as unknown as PrismaService,
      cache as unknown as CacheCatalogo,
    );
  });

  describe('crear', () => {
    it('E3-H4 · marca creada: el nombre no existe y la marca se guarda', async () => {
      const creada = await servicio.crear({ nombre: 'Kerastase' });

      expect(prisma.tx.marca.create).toHaveBeenCalledWith({
        data: { nombre: 'Kerastase' },
      });
      expect(creada).toMatchObject({
        id: 1,
        nombre: 'Kerastase',
        activa: true,
      });
    });

    it('E3-H4 · marca repetida: rechaza con 409 y no guarda nada', async () => {
      prisma.tx.marca.findFirst.mockResolvedValue({ id: 7 });

      await expect(
        servicio.crear({ nombre: 'KERASTASE' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.tx.marca.create).not.toHaveBeenCalled();
      expect(cache.invalidar).not.toHaveBeenCalled();
    });

    it('E2-H1 · marca creada: invalida las marcas de la tienda después del commit', async () => {
      await servicio.crear({ nombre: 'Kerastase' });

      expect(cache.invalidar).toHaveBeenCalledWith('cache:tienda:marcas');
      expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
        cache.invalidar.mock.invocationCallOrder[0]!,
      );
    });

    it('busca el nombre sin distinguir mayúsculas y bajo el bloqueo de la transacción', async () => {
      await servicio.crear({ nombre: 'Kerastase' });

      expect(prisma.tx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(prisma.tx.marca.findFirst).toHaveBeenCalledWith({
        where: { nombre: { equals: 'Kerastase', mode: 'insensitive' } },
        select: { id: true },
      });
      const ordenBloqueo = prisma.tx.$executeRaw.mock.invocationCallOrder[0]!;
      const ordenBusqueda =
        prisma.tx.marca.findFirst.mock.invocationCallOrder[0]!;
      expect(ordenBloqueo).toBeLessThan(ordenBusqueda);
    });
  });

  describe('listar', () => {
    it('E3-H4 · queda disponible: por defecto lista solo las activas por nombre', async () => {
      await servicio.listar();

      expect(prisma.marca.findMany).toHaveBeenCalledWith({
        where: { activa: true },
        orderBy: { nombre: 'asc' },
      });
    });

    it('con incluirInactivas lista también las desactivadas', async () => {
      await servicio.listar(true);

      expect(prisma.marca.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { nombre: 'asc' },
      });
    });
  });
});
