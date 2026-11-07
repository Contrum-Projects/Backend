import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { FirmaSugerencia } from './firma-sugerencia.js';
import {
  MENSAJE_SUGERENCIA_INVALIDA,
  ProductosService,
} from './productos.service.js';

const firma = new FirmaSugerencia({
  get: () => 's'.repeat(32),
} as unknown as ConfigService<Entorno, true>);

const TEXTO_IA = 'Shampoo reparador para cabello dañado.';
const sugerencia = { descripcion: TEXTO_IA, firma: firma.firmar(TEXTO_IA) };

const origenGuardado = (llamada: unknown) =>
  (llamada as { data: { origenDescripcion?: string } }).data.origenDescripcion;

const producto = (extra: object = {}) => ({
  id: 5,
  nombre: 'Shampoo reparador',
  descripcion: 'Repara el cabello.',
  origenDescripcion: 'manual',
  canalVenta: 'general',
  activo: true,
  marca: { id: 2, nombre: 'Kerastase' },
  categoria: { id: 3, nombre: 'Shampoos' },
  ...extra,
});

const crearPrisma = () => ({
  producto: {
    create: vi.fn().mockResolvedValue(producto()),
    findUnique: vi.fn().mockResolvedValue({
      descripcion: 'Repara el cabello.',
      origenDescripcion: 'manual',
      activo: true,
    }),
    findMany: vi.fn().mockResolvedValue([producto()]),
    count: vi.fn().mockResolvedValue(1),
    update: vi.fn().mockResolvedValue(producto()),
  },
  categoria: { findUnique: vi.fn().mockResolvedValue({ id: 3 }) },
  marca: { findUnique: vi.fn().mockResolvedValue({ activa: true }) },
  $transaction: vi.fn((consultas: Promise<unknown>[]) =>
    Promise.all(consultas),
  ),
});

const datosNuevos = {
  nombre: 'Shampoo reparador',
  descripcion: 'Repara el cabello.',
  categoriaId: 3,
  marcaId: 2,
  canalVenta: 'general',
};

describe('ProductosService', () => {
  let prisma: ReturnType<typeof crearPrisma>;
  let servicio: ProductosService;

  beforeEach(() => {
    prisma = crearPrisma();
    servicio = new ProductosService(prisma as unknown as PrismaService, firma);
  });

  describe('origen de la descripción (E4-H2)', () => {
    it('E4-H2 · sugerencia aceptada: al crear, la descripción se guarda con origen «IA»', async () => {
      await servicio.crear({
        ...datosNuevos,
        descripcion: TEXTO_IA,
        sugerencia,
      });

      const [llamada] = prisma.producto.create.mock.calls[0];
      expect(origenGuardado(llamada)).toBe('ia');
      expect(llamada).toMatchObject({ data: { descripcion: TEXTO_IA } });
    });

    it('E4-H2 · sugerencia editada: al crear, el texto corregido se guarda con origen «IA editada»', async () => {
      await servicio.crear({
        ...datosNuevos,
        descripcion: 'Shampoo reparador para cabello teñido.',
        sugerencia,
      });

      const [llamada] = prisma.producto.create.mock.calls[0];
      expect(origenGuardado(llamada)).toBe('ia_editada');
      expect(llamada).toMatchObject({
        data: { descripcion: 'Shampoo reparador para cabello teñido.' },
      });
    });

    it('E4-H2 · sugerencia descartada: el texto propio, sin sugerencia, se guarda con origen «manual»', async () => {
      await servicio.crear({ ...datosNuevos, descripcion: 'Texto propio.' });

      expect(origenGuardado(prisma.producto.create.mock.calls[0][0])).toBe(
        'manual',
      );
    });

    it('E4-H2 · sin publicación automática: una sugerencia con firma que no corresponde se rechaza con 400 y no guarda nada', async () => {
      await expect(
        servicio.crear({
          ...datosNuevos,
          descripcion: 'Texto inventado.',
          sugerencia: {
            descripcion: 'Texto inventado.',
            firma: sugerencia.firma,
          },
        }),
      ).rejects.toThrow(new BadRequestException(MENSAJE_SUGERENCIA_INVALIDA));
      expect(prisma.producto.create).not.toHaveBeenCalled();
    });

    it('E4-H2 · al editar con la sugerencia: igual a la sugerida queda «IA» y cambiada queda «IA editada»', async () => {
      await servicio.actualizar(5, { descripcion: TEXTO_IA, sugerencia });
      await servicio.actualizar(5, {
        descripcion: 'Texto corregido.',
        sugerencia,
      });

      const [aceptada, editada] = prisma.producto.update.mock.calls;
      expect(origenGuardado(aceptada[0])).toBe('ia');
      expect(origenGuardado(editada[0])).toBe('ia_editada');
    });

    it('E4-H2 · al editar, una sugerencia sin descripción o con firma inválida: 400 sin cambios', async () => {
      await expect(
        servicio.actualizar(5, { nombre: 'Otro', sugerencia }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        servicio.actualizar(5, {
          descripcion: TEXTO_IA,
          sugerencia: { descripcion: TEXTO_IA, firma: '0'.repeat(64) },
        }),
      ).rejects.toThrow(MENSAJE_SUGERENCIA_INVALIDA);
      expect(prisma.producto.update).not.toHaveBeenCalled();
    });
  });

  describe('ingredientes (E4-H2)', () => {
    it('E4-H2 · ingredientes: se guardan al crear y se pueden cambiar o borrar al editar', async () => {
      await servicio.crear({ ...datosNuevos, ingredientes: 'Aqua, Glycerin' });
      expect(prisma.producto.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ingredientes: 'Aqua, Glycerin',
          }) as unknown,
        }),
      );

      await servicio.actualizar(5, { ingredientes: null });
      expect(prisma.producto.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ingredientes: null }) as unknown,
        }),
      );
    });
  });

  describe('crear', () => {
    it('E3-H1 · producto creado: se guarda activo, con su categoría y marca, y descripción manual', async () => {
      const creado = await servicio.crear(datosNuevos);

      expect(prisma.producto.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            nombre: 'Shampoo reparador',
            descripcion: 'Repara el cabello.',
            categoriaId: 3,
            marcaId: 2,
            canalVenta: 'general',
            origenDescripcion: 'manual',
          },
        }),
      );
      expect(creado).toMatchObject({ id: 5, activo: true });
    });

    it('E3-H1 · categoría inexistente: rechaza con 404 y no guarda nada', async () => {
      prisma.categoria.findUnique.mockResolvedValue(null);

      await expect(servicio.crear(datosNuevos)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.producto.create).not.toHaveBeenCalled();
    });

    it('E3-H1 · marca inexistente: rechaza con 404 y no guarda nada', async () => {
      prisma.marca.findUnique.mockResolvedValue(null);

      await expect(servicio.crear(datosNuevos)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.producto.create).not.toHaveBeenCalled();
    });

    it('E3-H1 · marca desactivada: rechaza con 400 y no guarda nada', async () => {
      prisma.marca.findUnique.mockResolvedValue({ activa: false });

      await expect(servicio.crear(datosNuevos)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.producto.create).not.toHaveBeenCalled();
    });
  });

  describe('actualizar', () => {
    it('E3-H1 · producto editado: guarda solo los campos que llegan', async () => {
      await servicio.actualizar(5, { nombre: 'Shampoo nutritivo' });

      expect(prisma.producto.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 5 },
          data: {
            nombre: 'Shampoo nutritivo',
            descripcion: undefined,
            categoriaId: undefined,
            marcaId: undefined,
            canalVenta: undefined,
            origenDescripcion: undefined,
          },
        }),
      );
    });

    it('E3-H1 · producto inexistente: rechaza con 404', async () => {
      prisma.producto.findUnique.mockResolvedValue(null);

      await expect(
        servicio.actualizar(99, { nombre: 'Otro' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.producto.update).not.toHaveBeenCalled();
    });

    it('rechaza con 400 un cuerpo sin cambios', async () => {
      await expect(servicio.actualizar(5, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('E3-H1 · categoría o marca inválida al editar: rechaza y no guarda', async () => {
      prisma.categoria.findUnique.mockResolvedValue(null);
      await expect(
        servicio.actualizar(5, { categoriaId: 77 }),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.marca.findUnique.mockResolvedValue({ activa: false });
      await expect(
        servicio.actualizar(5, { marcaId: 8 }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.producto.update).not.toHaveBeenCalled();
    });

    it('descripción sugerida por IA y cambiada: el origen pasa a ia_editada', async () => {
      prisma.producto.findUnique.mockResolvedValue({
        descripcion: 'Texto de la IA.',
        origenDescripcion: 'ia',
      });

      await servicio.actualizar(5, { descripcion: 'Texto corregido.' });

      expect(prisma.producto.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            origenDescripcion: 'ia_editada',
          }) as unknown,
        }),
      );
    });

    it('descripción de IA reenviada igual, o descripción manual cambiada: el origen no cambia', async () => {
      prisma.producto.findUnique.mockResolvedValue({
        descripcion: 'Texto de la IA.',
        origenDescripcion: 'ia',
      });
      await servicio.actualizar(5, { descripcion: 'Texto de la IA.' });

      prisma.producto.findUnique.mockResolvedValue({
        descripcion: 'Texto manual.',
        origenDescripcion: 'manual',
      });
      await servicio.actualizar(5, { descripcion: 'Otro texto.' });

      for (const [argumentos] of prisma.producto.update.mock.calls) {
        expect(
          (argumentos as { data: { origenDescripcion?: string } }).data
            .origenDescripcion,
        ).toBeUndefined();
      }
    });
  });

  describe('desactivar', () => {
    it('E3-H1 · producto desactivado: queda inactivo y no se borra', async () => {
      await servicio.desactivar(5);

      expect(prisma.producto.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 5 },
          data: { activo: false },
        }),
      );
    });

    it('producto ya desactivado: no vuelve a escribir y devuelve el producto', async () => {
      prisma.producto.findUnique.mockResolvedValue({
        ...producto({ activo: false }),
      });

      const resultado = await servicio.desactivar(5);

      expect(prisma.producto.update).not.toHaveBeenCalled();
      expect(resultado).toMatchObject({ activo: false });
    });

    it('E3-H1 · producto inexistente: rechaza con 404', async () => {
      prisma.producto.findUnique.mockResolvedValue(null);

      await expect(servicio.desactivar(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
