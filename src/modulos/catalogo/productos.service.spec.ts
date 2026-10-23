import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ProductosService } from './productos.service.js';

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
    servicio = new ProductosService(prisma as unknown as PrismaService);
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

  describe('listar', () => {
    it('por defecto muestra solo los activos, página 1 de 20, ordenados por nombre', async () => {
      const respuesta = await servicio.listar({});

      expect(prisma.producto.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ activo: true }) as unknown,
          orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
          skip: 0,
          take: 20,
        }),
      );
      expect(respuesta).toMatchObject({ total: 1, pagina: 1, limite: 20 });
    });

    it('con incluirInactivos no filtra por estado; aplica texto, categoría, marca y página', async () => {
      await servicio.listar({
        incluirInactivos: true,
        buscar: 'shampoo',
        categoriaId: 3,
        marcaId: 2,
        pagina: 3,
        limite: 10,
      });

      expect(prisma.producto.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            activo: undefined,
            categoriaId: 3,
            marcaId: 2,
            nombre: { contains: 'shampoo', mode: 'insensitive' },
          },
          skip: 20,
          take: 10,
        }),
      );
    });
  });
});
