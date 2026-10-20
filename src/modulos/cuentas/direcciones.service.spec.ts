import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { DireccionesService } from './direcciones.service.js';
import type { CrearDireccionDto } from './dto/guardar-direccion.dto.js';

const CODIGO = '3f0c2a52-0b9e-4c55-9d0e-6a3a4f6d1b2c';

const crearPrisma = () => {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 7 }]),
    comuna: { findUnique: vi.fn().mockResolvedValue({ id: 30 }) },
    direccion: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 1 }),
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({ id: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn().mockResolvedValue({ id: 1 }),
    },
  };
  const prisma = {
    direccion: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { prisma, tx };
};

const dtoBase = (): CrearDireccionDto => ({
  calle: 'Av. Providencia',
  numero: '1234',
  comuna: '13123',
});

describe('DireccionesService', () => {
  let prisma: ReturnType<typeof crearPrisma>['prisma'];
  let tx: ReturnType<typeof crearPrisma>['tx'];
  let servicio: DireccionesService;

  beforeEach(() => {
    ({ prisma, tx } = crearPrisma());
    servicio = new DireccionesService(prisma as unknown as PrismaService);
  });

  it('listar filtra por la cuenta del token, con la principal primero', async () => {
    await servicio.listar(CODIGO);

    const consulta = prisma.direccion.findMany.mock.calls[0][0];
    expect(consulta.where).toEqual({ usuario: { codigoPublico: CODIGO } });
    expect(consulta.orderBy).toEqual([{ esPrincipal: 'desc' }, { id: 'asc' }]);
  });

  describe('crear', () => {
    it('la primera dirección de la cuenta queda como principal', async () => {
      await servicio.crear(CODIGO, dtoBase());

      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.direccion.create.mock.calls[0][0].data).toMatchObject({
        usuarioId: 7,
        comunaId: 30,
        calle: 'Av. Providencia',
        esPrincipal: true,
      });
      expect(tx.direccion.updateMany).not.toHaveBeenCalled();
    });

    it('las siguientes no son principales salvo que se pida', async () => {
      tx.direccion.count.mockResolvedValue(2);

      await servicio.crear(CODIGO, dtoBase());

      expect(tx.direccion.create.mock.calls[0][0].data.esPrincipal).toBe(false);
      expect(tx.direccion.updateMany).not.toHaveBeenCalled();
    });

    it('E1-H5 · dirección principal: crear una como principal desmarca la anterior', async () => {
      tx.direccion.count.mockResolvedValue(2);

      await servicio.crear(
        CODIGO,
        Object.assign(dtoBase(), { esPrincipal: true }),
      );

      expect(tx.direccion.updateMany.mock.calls[0][0]).toEqual({
        where: { usuarioId: 7, esPrincipal: true },
        data: { esPrincipal: false },
      });
      expect(tx.direccion.create.mock.calls[0][0].data.esPrincipal).toBe(true);
    });

    it('rechaza una comuna que no existe', async () => {
      tx.comuna.findUnique.mockResolvedValue(null);

      await expect(servicio.crear(CODIGO, dtoBase())).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.direccion.create).not.toHaveBeenCalled();
    });
  });

  describe('actualizar', () => {
    it('cambia solo la dirección de la cuenta', async () => {
      tx.direccion.findFirst.mockResolvedValue({ id: 5 });

      await servicio.actualizar(CODIGO, 5, { calle: 'Los Leones' });

      expect(tx.direccion.findFirst.mock.calls[0][0].where).toEqual({
        id: 5,
        usuarioId: 7,
      });
      const { where, data } = tx.direccion.update.mock.calls[0][0];
      expect(where).toEqual({ id: 5 });
      expect(data).toMatchObject({ calle: 'Los Leones', comunaId: undefined });
      expect(tx.comuna.findUnique).not.toHaveBeenCalled();
    });

    it('responde 404 si la dirección es de otra cuenta, antes de validar la comuna', async () => {
      tx.direccion.findFirst.mockResolvedValue(null);
      tx.comuna.findUnique.mockResolvedValue(null);

      await expect(
        servicio.actualizar(CODIGO, 5, { comuna: '99999' }),
      ).rejects.toThrow(NotFoundException);
      expect(tx.direccion.update).not.toHaveBeenCalled();
    });
  });

  describe('marcarPrincipal', () => {
    it('E1-H5 · dirección principal: deja esa dirección como la única principal', async () => {
      tx.direccion.findFirst.mockResolvedValue({ id: 5 });

      await servicio.marcarPrincipal(CODIGO, 5);

      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.direccion.findFirst.mock.calls[0][0].where).toEqual({
        id: 5,
        usuarioId: 7,
      });
      expect(tx.direccion.updateMany.mock.calls[0][0]).toEqual({
        where: { usuarioId: 7, esPrincipal: true, NOT: { id: 5 } },
        data: { esPrincipal: false },
      });
      expect(tx.direccion.update.mock.calls[0][0]).toMatchObject({
        where: { id: 5 },
        data: { esPrincipal: true },
      });
    });

    it('responde 404 si la dirección es de otra cuenta y no cambia nada', async () => {
      tx.direccion.findFirst.mockResolvedValue(null);

      await expect(servicio.marcarPrincipal(CODIGO, 5)).rejects.toThrow(
        NotFoundException,
      );
      expect(tx.direccion.updateMany).not.toHaveBeenCalled();
      expect(tx.direccion.update).not.toHaveBeenCalled();
    });
  });

  describe('eliminar', () => {
    it('si se elimina la principal, la más reciente de las que quedan pasa a serlo', async () => {
      tx.direccion.findFirst
        .mockResolvedValueOnce({ esPrincipal: true })
        .mockResolvedValueOnce({ id: 9 });

      await servicio.eliminar(CODIGO, 5);

      expect(tx.direccion.delete).toHaveBeenCalledWith({ where: { id: 5 } });
      expect(tx.direccion.findFirst.mock.calls[1][0]).toMatchObject({
        where: { usuarioId: 7 },
        orderBy: { id: 'desc' },
      });
      expect(tx.direccion.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: { esPrincipal: true },
      });
    });

    it('si no era la principal, no cambia la principal', async () => {
      tx.direccion.findFirst.mockResolvedValueOnce({ esPrincipal: false });

      await servicio.eliminar(CODIGO, 5);

      expect(tx.direccion.delete).toHaveBeenCalled();
      expect(tx.direccion.update).not.toHaveBeenCalled();
    });

    it('responde 404 si la dirección es de otra cuenta y no borra nada', async () => {
      tx.direccion.findFirst.mockResolvedValue(null);

      await expect(servicio.eliminar(CODIGO, 5)).rejects.toThrow(
        NotFoundException,
      );
      expect(tx.direccion.delete).not.toHaveBeenCalled();
    });
  });

  it('responde 404 si la cuenta del token ya no existe', async () => {
    tx.$queryRaw.mockResolvedValue([]);

    await expect(servicio.crear(CODIGO, dtoBase())).rejects.toThrow(
      NotFoundException,
    );
  });
});
