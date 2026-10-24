import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AlmacenArchivos } from '../../almacen/almacen-archivos.js';
import type { Entorno } from '../../config/entorno.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { type ArchivoSubido, ImagenesService } from './imagenes.service.js';

const BASE = 'https://imagenes.cabelloperfecto.cl';

const imagen = (id: number, orden: number, esPrincipal = false) => ({
  id,
  ubicacionArchivo: `articulos/11/img-${id}.jpg`,
  orden,
  esPrincipal,
});

const jpeg = (bytes = 1024): ArchivoSubido => {
  const buffer = Buffer.alloc(bytes);
  buffer.set([0xff, 0xd8, 0xff, 0xe0]);
  return { buffer, size: bytes };
};

const crearPrisma = (imagenes = [imagen(1, 1, true)]) => {
  const prisma = {
    // El bloqueo del artículo: [] cuando no existe
    $queryRaw: vi.fn().mockResolvedValue([{ id: 11 }]),
    articuloVenta: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 11, _count: { imagenes: imagenes.length } }),
    },
    imagenArticulo: {
      findMany: vi.fn().mockResolvedValue(imagenes),
      count: vi.fn().mockResolvedValue(imagenes.length),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(
    (trabajo: (tx: typeof prisma) => Promise<unknown>) => trabajo(prisma),
  );
  return prisma;
};

const crearAlmacen = () => ({
  guardar: vi.fn().mockResolvedValue(undefined),
  eliminar: vi.fn().mockResolvedValue(undefined),
});

const config = {
  get: vi.fn().mockReturnValue(BASE),
} as unknown as ConfigService<Entorno, true>;

describe('ImagenesService', () => {
  let prisma: ReturnType<typeof crearPrisma>;
  let almacen: ReturnType<typeof crearAlmacen>;
  let servicio: ImagenesService;

  const preparar = (imagenes?: ReturnType<typeof imagen>[]) => {
    prisma = crearPrisma(imagenes);
    almacen = crearAlmacen();
    servicio = new ImagenesService(
      prisma as unknown as PrismaService,
      almacen as unknown as AlmacenArchivos,
      config,
    );
  };

  beforeEach(() => preparar());

  describe('subir', () => {
    it('E3-H3 · imagen agregada: la guarda en el almacén, la asocia al artículo al final del orden y devuelve sus imágenes', async () => {
      preparar([imagen(1, 1, true)]);
      prisma.imagenArticulo.findMany.mockResolvedValue([
        imagen(1, 1, true),
        imagen(2, 2),
      ]);

      const imagenes = await servicio.subir(11, jpeg());

      expect(almacen.guardar).toHaveBeenCalledWith(
        expect.stringMatching(/^articulos\/11\/[0-9a-f-]{36}\.jpg$/),
        expect.any(Buffer),
        'image/jpeg',
      );
      const clave = almacen.guardar.mock.calls[0][0] as string;
      expect(prisma.imagenArticulo.create).toHaveBeenCalledWith({
        data: {
          articuloId: 11,
          ubicacionArchivo: clave,
          orden: 2,
          esPrincipal: false,
        },
      });
      expect(imagenes).toEqual([
        {
          id: 1,
          url: `${BASE}/articulos/11/img-1.jpg`,
          orden: 1,
          esPrincipal: true,
        },
        {
          id: 2,
          url: `${BASE}/articulos/11/img-2.jpg`,
          orden: 2,
          esPrincipal: false,
        },
      ]);
    });

    it('E3-H3 · imagen agregada: la primera imagen del artículo queda como principal', async () => {
      preparar([]);

      await servicio.subir(11, jpeg());

      expect(prisma.imagenArticulo.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orden: 1,
          esPrincipal: true,
        }) as object,
      });
    });

    it('E3-H3 · imagen agregada: reconoce PNG y WebP por sus bytes', async () => {
      const png = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0,
      ]);
      await servicio.subir(11, { buffer: png, size: png.length });
      const webp = Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1');
      await servicio.subir(11, { buffer: webp, size: webp.length });

      expect(almacen.guardar.mock.calls.map((llamada) => llamada[2])).toEqual([
        'image/png',
        'image/webp',
      ]);
      expect(almacen.guardar.mock.calls[1][0]).toMatch(/\.webp$/);
    });

    it('E3-H3 · archivo que no es JPEG, PNG ni WebP: 400 sin subir nada', async () => {
      const gif = Buffer.from('GIF89a', 'latin1');
      // Un nombre o tipo declarado de imagen no basta: manda el contenido
      await expect(
        servicio.subir(11, { buffer: gif, size: gif.length }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        servicio.subir(11, { buffer: Buffer.alloc(0), size: 0 }),
      ).rejects.toThrow(BadRequestException);

      expect(almacen.guardar).not.toHaveBeenCalled();
      expect(prisma.imagenArticulo.create).not.toHaveBeenCalled();
    });

    it('E3-H3 · sin archivo o de más de 5 MB: 400 sin subir nada', async () => {
      await expect(servicio.subir(11, undefined)).rejects.toThrow(
        'Adjunta una imagen JPEG, PNG o WebP en el campo «imagen».',
      );
      await expect(
        servicio.subir(11, jpeg(5 * 1024 * 1024 + 1)),
      ).rejects.toThrow('La imagen no puede superar los 5 MB.');

      expect(almacen.guardar).not.toHaveBeenCalled();
    });

    it('E3-H3 · artículo inexistente: 404 sin subir nada', async () => {
      prisma.articuloVenta.findUnique.mockResolvedValue(null);

      await expect(servicio.subir(99, jpeg())).rejects.toThrow(
        new NotFoundException('El artículo no existe.'),
      );
      expect(almacen.guardar).not.toHaveBeenCalled();
    });

    it('E3-H3 · artículo con 10 imágenes: 409 sin subir nada', async () => {
      preparar(Array.from({ length: 10 }, (_, i) => imagen(i + 1, i + 1)));

      await expect(servicio.subir(11, jpeg())).rejects.toThrow(
        new ConflictException(
          'El artículo ya tiene 10 imágenes: elimina una antes de subir otra.',
        ),
      );
      expect(almacen.guardar).not.toHaveBeenCalled();
    });

    it('E3-H3 · otra subida llenó el artículo mientras tanto: 409 y borra el archivo ya subido', async () => {
      // Al revisar antes de subir había 9; con el bloqueo tomado ya hay 10
      prisma.articuloVenta.findUnique.mockResolvedValue({
        id: 11,
        _count: { imagenes: 9 },
      });
      prisma.imagenArticulo.count.mockResolvedValue(10);

      await expect(servicio.subir(11, jpeg())).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.imagenArticulo.create).not.toHaveBeenCalled();
      expect(almacen.eliminar).toHaveBeenCalledWith(
        almacen.guardar.mock.calls[0][0],
      );
    });

    it('E3-H3 · falla la base al guardar: borra el archivo subido y propaga el error', async () => {
      prisma.imagenArticulo.create.mockRejectedValue(new Error('caída'));

      await expect(servicio.subir(11, jpeg())).rejects.toThrow('caída');
      expect(almacen.eliminar).toHaveBeenCalledWith(
        almacen.guardar.mock.calls[0][0],
      );
    });

    it('E3-H3 · el almacén no responde: 503 en español y no toca la base', async () => {
      almacen.guardar.mockRejectedValue(new Error('timeout'));

      await expect(servicio.subir(11, jpeg())).rejects.toThrow(
        new ServiceUnavailableException(
          'No se pudo guardar la imagen. Intenta de nuevo en unos minutos.',
        ),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('E3-H3 · almacén sin configurar: 503 y no toca la base', async () => {
      almacen.guardar.mockRejectedValue(
        new ServiceUnavailableException(
          'El almacenamiento de imágenes no está configurado.',
        ),
      );

      await expect(servicio.subir(11, jpeg())).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('listar', () => {
    it('E3-H3 · devuelve las imágenes en su orden, con su URL pública', async () => {
      preparar([imagen(5, 1), imagen(4, 2, true)]);

      expect(await servicio.listar(11)).toEqual([
        {
          id: 5,
          url: `${BASE}/articulos/11/img-5.jpg`,
          orden: 1,
          esPrincipal: false,
        },
        {
          id: 4,
          url: `${BASE}/articulos/11/img-4.jpg`,
          orden: 2,
          esPrincipal: true,
        },
      ]);
      expect(prisma.imagenArticulo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { articuloId: 11 },
          orderBy: [{ orden: 'asc' }, { id: 'asc' }],
        }),
      );
    });

    it('E3-H3 · artículo inexistente: 404', async () => {
      prisma.articuloVenta.findUnique.mockResolvedValue(null);

      await expect(servicio.listar(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('ordenar', () => {
    beforeEach(() =>
      preparar([imagen(1, 1, true), imagen(2, 2), imagen(3, 3)]),
    );

    it('E3-H3 · imagen principal y orden: guarda el nuevo orden y deja una sola principal', async () => {
      await servicio.ordenar(11, { orden: [3, 1, 2], principalId: 2 });

      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.imagenArticulo.update.mock.calls).toEqual([
        [{ where: { id: 3 }, data: { orden: 1, esPrincipal: false } }],
        [{ where: { id: 1 }, data: { orden: 2, esPrincipal: false } }],
        [{ where: { id: 2 }, data: { orden: 3, esPrincipal: true } }],
      ]);
    });

    it('E3-H3 · imagen principal y orden: devuelve las imágenes como quedaron', async () => {
      prisma.imagenArticulo.findMany
        .mockResolvedValueOnce([imagen(1, 1, true), imagen(2, 2), imagen(3, 3)])
        .mockResolvedValueOnce([
          imagen(2, 1, true),
          imagen(1, 2),
          imagen(3, 3),
        ]);

      const imagenes = await servicio.ordenar(11, {
        orden: [2, 1, 3],
        principalId: 2,
      });

      expect(
        imagenes.map(({ id, orden, esPrincipal }) => ({
          id,
          orden,
          esPrincipal,
        })),
      ).toEqual([
        { id: 2, orden: 1, esPrincipal: true },
        { id: 1, orden: 2, esPrincipal: false },
        { id: 3, orden: 3, esPrincipal: false },
      ]);
    });

    it('E3-H3 · el orden no trae exactamente las imágenes del artículo: 400 sin cambios', async () => {
      for (const orden of [
        [1, 2],
        [1, 2, 3, 4],
        [1, 2, 9],
      ]) {
        await expect(
          servicio.ordenar(11, { orden, principalId: 1 }),
        ).rejects.toThrow(
          new BadRequestException(
            'Indica todas las imágenes del artículo, cada una una vez.',
          ),
        );
      }
      expect(prisma.imagenArticulo.update).not.toHaveBeenCalled();
    });

    it('E3-H3 · la principal no es una de las imágenes del artículo: 400 sin cambios', async () => {
      await expect(
        servicio.ordenar(11, { orden: [1, 2, 3], principalId: 9 }),
      ).rejects.toThrow(
        new BadRequestException(
          'La imagen principal debe ser una de las imágenes del artículo.',
        ),
      );
      expect(prisma.imagenArticulo.update).not.toHaveBeenCalled();
    });

    it('E3-H3 · artículo inexistente: 404', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(
        servicio.ordenar(99, { orden: [1], principalId: 1 }),
      ).rejects.toThrow(new NotFoundException('El artículo no existe.'));
    });
  });

  describe('eliminar', () => {
    it('E3-H3 · única imagen del artículo: no la elimina (409)', async () => {
      preparar([imagen(1, 1, true)]);

      await expect(servicio.eliminar(11, 1)).rejects.toThrow(
        new ConflictException(
          'El artículo debe tener al menos una imagen: sube otra antes de eliminar esta.',
        ),
      );
      expect(prisma.imagenArticulo.delete).not.toHaveBeenCalled();
      expect(almacen.eliminar).not.toHaveBeenCalled();
    });

    it('E3-H3 · elimina una imagen, cierra el hueco del orden y borra el archivo después de guardar', async () => {
      preparar([imagen(1, 1, true), imagen(2, 2), imagen(3, 3)]);

      await servicio.eliminar(11, 2);

      expect(prisma.imagenArticulo.delete).toHaveBeenCalledWith({
        where: { id: 2 },
      });
      expect(prisma.imagenArticulo.update.mock.calls).toEqual([
        [{ where: { id: 3 }, data: { orden: 2, esPrincipal: false } }],
      ]);
      expect(almacen.eliminar).toHaveBeenCalledWith('articulos/11/img-2.jpg');
      // El archivo se borra recién confirmada la transacción
      expect(almacen.eliminar.mock.invocationCallOrder[0]).toBeGreaterThan(
        prisma.$transaction.mock.invocationCallOrder[0],
      );
    });

    it('E3-H3 · al eliminar la principal, la siguiente en el orden pasa a ser la principal', async () => {
      preparar([imagen(1, 1, true), imagen(2, 2), imagen(3, 3)]);

      await servicio.eliminar(11, 1);

      expect(prisma.imagenArticulo.update.mock.calls).toEqual([
        [{ where: { id: 2 }, data: { orden: 1, esPrincipal: true } }],
        [{ where: { id: 3 }, data: { orden: 2, esPrincipal: false } }],
      ]);
    });

    it('E3-H3 · no se puede borrar el archivo del almacén: la imagen igual queda eliminada', async () => {
      preparar([imagen(1, 1, true), imagen(2, 2)]);
      almacen.eliminar.mockRejectedValue(new Error('R2 caído'));

      await expect(servicio.eliminar(11, 2)).resolves.toBeDefined();
      expect(prisma.imagenArticulo.delete).toHaveBeenCalled();
    });

    it('E3-H3 · imagen de otro artículo o inexistente: 404', async () => {
      preparar([imagen(1, 1, true), imagen(2, 2)]);

      await expect(servicio.eliminar(11, 77)).rejects.toThrow(
        new NotFoundException('La imagen no existe.'),
      );
      expect(prisma.imagenArticulo.delete).not.toHaveBeenCalled();
    });

    it('E3-H3 · artículo inexistente: 404', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(servicio.eliminar(99, 1)).rejects.toThrow(
        new NotFoundException('El artículo no existe.'),
      );
    });
  });
});
