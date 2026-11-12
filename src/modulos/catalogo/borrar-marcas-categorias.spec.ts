import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { type CacheCatalogo, CLAVES_CACHE } from './cache-catalogo.js';
import { CategoriasService } from './categorias.service.js';
import { MarcasService } from './marcas.service.js';
import { exigirSinUsos } from './usos-catalogo.js';

interface Conteos {
  productos?: number;
  subcategorias?: number;
  cupones?: number;
  portada?: number;
  existe?: boolean;
}

const crearPrisma = ({
  productos = 0,
  subcategorias = 0,
  cupones = 0,
  portada = 0,
  existe = true,
}: Conteos = {}) => {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    marca: {
      findUnique: vi.fn().mockResolvedValue(existe ? { id: 5 } : null),
      delete: vi.fn().mockResolvedValue({}),
    },
    categoria: {
      findUnique: vi.fn().mockResolvedValue(existe ? { id: 3 } : null),
      count: vi.fn().mockResolvedValue(subcategorias),
      delete: vi.fn().mockResolvedValue({}),
    },
    producto: { count: vi.fn().mockResolvedValue(productos) },
    cuponMarca: { count: vi.fn().mockResolvedValue(cupones) },
    cuponCategoria: { count: vi.fn().mockResolvedValue(cupones) },
    slidePortada: { count: vi.fn().mockResolvedValue(portada) },
  };
  return {
    tx,
    $transaction: vi.fn((funcion: (cliente: typeof tx) => unknown) =>
      funcion(tx),
    ),
  };
};

const servicios = (prisma: ReturnType<typeof crearPrisma>) => {
  const cache = { invalidar: vi.fn().mockResolvedValue(undefined) };
  return {
    cache,
    marcas: new MarcasService(
      prisma as unknown as PrismaService,
      cache as unknown as CacheCatalogo,
    ),
    categorias: new CategoriasService(
      prisma as unknown as PrismaService,
      cache as unknown as CacheCatalogo,
    ),
  };
};

describe('Borrar marcas y categorías (SCRUM-158)', () => {
  it('SCRUM-158 · criterio 2: una marca sin usos se borra e invalida las marcas de la tienda', async () => {
    const prisma = crearPrisma();
    const { marcas, cache } = servicios(prisma);

    await marcas.eliminar(5);

    expect(prisma.tx.marca.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(prisma.tx.slidePortada.count).toHaveBeenCalledWith({
      where: { tipoDestino: 'marca', destino: '5' },
    });
    expect(cache.invalidar).toHaveBeenCalledWith(CLAVES_CACHE.MARCAS);
  });

  it('SCRUM-158 · criterio 3: una marca en uso no se borra y dice dónde se usa', async () => {
    const prisma = crearPrisma({ productos: 4, cupones: 1 });
    const { marcas, cache } = servicios(prisma);

    const error = await marcas.eliminar(5).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(
      'No se puede borrar: la usan 4 productos y 1 cupón. Cámbialos a otra marca antes de borrarla.',
    );
    expect(prisma.tx.marca.delete).not.toHaveBeenCalled();
    expect(cache.invalidar).not.toHaveBeenCalled();
  });

  it('SCRUM-158 · criterio 3: una categoría con subcategorías o en la portada no se borra', async () => {
    const prisma = crearPrisma({ subcategorias: 2, portada: 1 });
    const { categorias } = servicios(prisma);

    await expect(categorias.eliminar(3)).rejects.toThrow(
      'No se puede borrar: la usan 2 subcategorías y 1 imagen de la portada. Cámbialos a otra categoría antes de borrarla.',
    );
    expect(prisma.tx.categoria.delete).not.toHaveBeenCalled();
  });

  it('SCRUM-158 · criterio 2: una categoría sin usos se borra e invalida el árbol de la tienda', async () => {
    const prisma = crearPrisma();
    const { categorias, cache } = servicios(prisma);

    await categorias.eliminar(3);

    expect(prisma.tx.categoria.delete).toHaveBeenCalledWith({
      where: { id: 3 },
    });
    expect(cache.invalidar).toHaveBeenCalledWith(CLAVES_CACHE.CATEGORIAS);
  });

  it('una marca o categoría que no existe responde 404', async () => {
    const prisma = crearPrisma({ existe: false });
    const { marcas, categorias } = servicios(prisma);

    await expect(marcas.eliminar(99)).rejects.toThrow(NotFoundException);
    await expect(categorias.eliminar(99)).rejects.toThrow(NotFoundException);
  });

  it('si otra petición la empezó a usar al mismo tiempo (P2003), responde 409', async () => {
    const prisma = crearPrisma();
    prisma.tx.marca.delete.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('llave foránea', {
        code: 'P2003',
        clientVersion: 'prueba',
      }),
    );
    const { marcas } = servicios(prisma);

    await expect(marcas.eliminar(5)).rejects.toThrow(ConflictException);
  });

  it('el mensaje usa singular con un solo uso', () => {
    expect(() =>
      exigirSinUsos({ productos: 1, cupones: 0, portada: 0 }, 'marca'),
    ).toThrow(
      'No se puede borrar: la usa 1 producto. Cámbialos a otra marca antes de borrarla.',
    );
  });
});
