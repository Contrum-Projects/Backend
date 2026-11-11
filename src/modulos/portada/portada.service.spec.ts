import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AlmacenArchivos } from '../../almacen/almacen-archivos.js';
import type { Entorno } from '../../config/entorno.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { ArchivoSubido } from '../catalogo/imagenes.service.js';
import {
  claveDestino,
  type DestinoResuelto,
  type DestinosPortada,
} from './destinos-portada.js';
import {
  MAXIMO_SLIDES_PORTADA,
  PortadaService,
  VERSIONES_IMAGEN,
} from './portada.service.js';

const BASE = 'https://imagenes.cabelloperfecto.cl';

interface Fila {
  id: number;
  imagenEscritorio: string;
  imagenCelular: string | null;
  orden: number;
  tipoDestino: string;
  destino: string;
}

const slide = (id: number, orden: number, extra: Partial<Fila> = {}): Fila => ({
  id,
  imagenEscritorio: `portada/e-${id}.jpg`,
  imagenCelular: null,
  orden,
  tipoDestino: 'pack',
  destino: String(10 + id),
  ...extra,
});

const jpeg = (bytes = 1024): ArchivoSubido => {
  const buffer = Buffer.alloc(bytes);
  buffer.set([0xff, 0xd8, 0xff, 0xe0]);
  return { buffer, size: bytes };
};

const crear = (
  filas: Fila[] = [slide(1, 1)],
  disponibles: Record<string, DestinoResuelto> = {},
) => {
  const slidePortada = {
    count: vi.fn().mockResolvedValue(filas.length),
    findMany: vi.fn().mockResolvedValue(filas),
    findUnique: vi.fn(({ where }: { where: { id: number } }) =>
      Promise.resolve(filas.find((fila) => fila.id === where.id) ?? null),
    ),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    delete: vi.fn().mockResolvedValue({}),
  };
  const prisma = {
    slidePortada,
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const resuelto = (tipo: string, destino: string): DestinoResuelto =>
    disponibles[claveDestino(tipo, destino)] ?? {
      nombre: `Pack ${destino}`,
      disponible: true,
    };
  const destinos = {
    resolver: vi.fn((pedidos: Fila[]) =>
      Promise.resolve(
        new Map(
          pedidos.map((p) => [
            claveDestino(p.tipoDestino, p.destino),
            resuelto(p.tipoDestino, p.destino),
          ]),
        ),
      ),
    ),
    resolverUno: vi.fn((tipo: string, destino: string) =>
      Promise.resolve(resuelto(tipo, destino)),
    ),
    opciones: vi.fn(),
  };
  const almacen = {
    guardar: vi.fn().mockResolvedValue(undefined),
    eliminar: vi.fn().mockResolvedValue(undefined),
  };
  const config = { get: vi.fn().mockReturnValue(BASE) };
  const servicio = new PortadaService(
    prisma as unknown as PrismaService,
    almacen as unknown as AlmacenArchivos,
    destinos as unknown as DestinosPortada,
    config as unknown as ConfigService<Entorno, true>,
  );
  return { servicio, prisma, almacen, destinos };
};

const PACK = { tipoDestino: 'pack' as const, destino: '11' };

describe('PortadaService (SCRUM-157)', () => {
  describe('crear', () => {
    it('SCRUM-157 · criterio 1: escritorio obligatoria y celular opcional', async () => {
      const { servicio, almacen, prisma } = crear([]);
      await servicio.crear(PACK, jpeg(), undefined);
      expect(almacen.guardar).toHaveBeenCalledTimes(1);
      expect(prisma.slidePortada.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ imagenCelular: null, orden: 1 }),
      });

      await servicio.crear(PACK, jpeg(), jpeg());
      expect(almacen.guardar).toHaveBeenCalledTimes(3);
    });

    it('SCRUM-157 · criterio 1: sin imagen de escritorio responde 400 en ese campo', async () => {
      const { servicio, almacen } = crear([]);
      const error = await servicio
        .crear(PACK, undefined, jpeg())
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        errores: [{ campo: VERSIONES_IMAGEN.ESCRITORIO }],
      });
      expect(almacen.guardar).not.toHaveBeenCalled();
    });

    it('SCRUM-157 · criterio 4: rechaza archivos que no son imágenes y los de más de 4 MB', async () => {
      const { servicio } = crear([]);
      const texto = { buffer: Buffer.from('hola'), size: 4 };
      await expect(servicio.crear(PACK, texto, undefined)).rejects.toThrow(
        'La imagen debe ser JPEG, PNG o WebP.',
      );
      await expect(
        servicio.crear(PACK, { ...jpeg(), size: 5 * 1024 * 1024 }, undefined),
      ).rejects.toThrow('La imagen no puede superar los 4 MB.');
    });

    it(`SCRUM-157 · criterio 4: con ${MAXIMO_SLIDES_PORTADA} slides responde 409 sin subir nada`, async () => {
      const llenos = Array.from({ length: MAXIMO_SLIDES_PORTADA }, (_, i) =>
        slide(i + 1, i + 1),
      );
      const { servicio, almacen } = crear(llenos);
      await expect(servicio.crear(PACK, jpeg(), undefined)).rejects.toThrow(
        ConflictException,
      );
      expect(almacen.guardar).not.toHaveBeenCalled();
    });

    it('SCRUM-157 · criterio 2: un destino que no está a la venta responde 400 en «destino»', async () => {
      const { servicio, almacen } = crear([], {
        [claveDestino('pack', '11')]: { nombre: 'Pack', disponible: false },
      });
      const error = await servicio
        .crear(PACK, jpeg(), undefined)
        .catch((e: unknown) => e);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        errores: [{ campo: 'destino' }],
      });
      expect(almacen.guardar).not.toHaveBeenCalled();
    });

    it('SCRUM-157 · criterio 2: un id de destino imposible responde 400 sin consultar', async () => {
      const { servicio, destinos } = crear([]);
      await expect(
        servicio.crear(
          { tipoDestino: 'producto', destino: 'abc' },
          jpeg(),
          undefined,
        ),
      ).rejects.toThrow('El destino elegido no es válido.');
      expect(destinos.resolverUno).not.toHaveBeenCalled();
    });

    it('si la base falla, borra los archivos subidos', async () => {
      const { servicio, prisma, almacen } = crear([]);
      prisma.slidePortada.create.mockRejectedValueOnce(new Error('caída'));
      await expect(servicio.crear(PACK, jpeg(), jpeg())).rejects.toThrow(
        'caída',
      );
      expect(almacen.eliminar).toHaveBeenCalledTimes(2);
    });
  });

  describe('listar', () => {
    it('SCRUM-157 · criterio 5: la tienda omite los slides sin destino disponible; el panel los marca', async () => {
      const filas = [slide(1, 1), slide(2, 2)];
      const { servicio } = crear(filas, {
        [claveDestino('pack', '12')]: { nombre: 'Viejo', disponible: false },
      });
      const tienda = await servicio.listarTienda();
      expect(tienda.map((s) => s.id)).toEqual([1]);
      expect(tienda[0]).not.toHaveProperty('disponible');
      expect(tienda[0].imagenEscritorio).toBe(`${BASE}/portada/e-1.jpg`);

      const panel = await servicio.listarPanel();
      expect(panel.map((s) => s.disponible)).toEqual([true, false]);
    });
  });

  describe('editar', () => {
    it('SCRUM-157 · criterio 3: reemplazar una imagen borra la anterior del almacén', async () => {
      const { servicio, almacen, prisma } = crear([
        slide(1, 1, { imagenCelular: 'portada/c-1.jpg' }),
      ]);
      await servicio.reemplazarImagen(1, VERSIONES_IMAGEN.CELULAR, jpeg());
      expect(prisma.slidePortada.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { imagenCelular: expect.stringMatching(/^portada\/.+\.jpg$/) },
      });
      expect(almacen.eliminar).toHaveBeenCalledWith('portada/c-1.jpg');
    });

    it('SCRUM-157 · criterio 1: quitar la imagen de celular la deja en null', async () => {
      const { servicio, almacen, prisma } = crear([
        slide(1, 1, { imagenCelular: 'portada/c-1.jpg' }),
      ]);
      await servicio.quitarImagenCelular(1);
      expect(prisma.slidePortada.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { imagenCelular: null },
      });
      expect(almacen.eliminar).toHaveBeenCalledWith('portada/c-1.jpg');
    });

    it('SCRUM-157 · criterio 3: ordenar exige todos los slides, cada uno una vez', async () => {
      const { servicio, prisma } = crear([slide(1, 1), slide(2, 2)]);
      await expect(servicio.ordenar({ orden: [2] })).rejects.toThrow(
        BadRequestException,
      );
      await servicio.ordenar({ orden: [2, 1] });
      expect(prisma.slidePortada.update).toHaveBeenNthCalledWith(1, {
        where: { id: 2 },
        data: { orden: 1 },
      });
    });

    it('SCRUM-157 · criterio 3: eliminar cierra el hueco y borra sus archivos', async () => {
      const { servicio, prisma, almacen } = crear([
        slide(1, 1, { imagenCelular: 'portada/c-1.jpg' }),
        slide(2, 2),
      ]);
      await servicio.eliminar(1);
      expect(prisma.slidePortada.updateMany).toHaveBeenCalledWith({
        where: { orden: { gt: 1 } },
        data: { orden: { decrement: 1 } },
      });
      expect(almacen.eliminar).toHaveBeenCalledWith('portada/e-1.jpg');
      expect(almacen.eliminar).toHaveBeenCalledWith('portada/c-1.jpg');
    });

    it('un slide que no existe responde 404', async () => {
      const { servicio } = crear([]);
      await expect(servicio.eliminar(9)).rejects.toThrow(NotFoundException);
      await expect(servicio.cambiarDestino(9, PACK)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
