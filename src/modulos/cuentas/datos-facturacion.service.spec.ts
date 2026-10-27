import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { DatosFacturacionService } from './datos-facturacion.service.js';
import type { CrearDatosFacturacionDto } from './dto/guardar-datos-facturacion.dto.js';

const CODIGO = '3f0c2a52-0b9e-4c55-9d0e-6a3a4f6d1b2c';

const crearPrisma = () => {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 7 }]),
    comuna: { findUnique: vi.fn().mockResolvedValue({ id: 30 }) },
    datosFacturacion: {
      create: vi.fn().mockResolvedValue({ id: 1 }),
      findFirst: vi.fn().mockResolvedValue({ id: 5 }),
      update: vi.fn().mockResolvedValue({ id: 5 }),
    },
  };
  const prisma = {
    datosFacturacion: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { prisma, tx };
};

const dtoBase = (): CrearDatosFacturacionDto => ({
  rut: '76086429-3',
  razonSocial: 'Peluquería Los Aromos SpA',
  giro: 'Servicios de peluquería',
  direccion: 'Av. Providencia 1234',
  comuna: '13123',
});

describe('DatosFacturacionService', () => {
  let prisma: ReturnType<typeof crearPrisma>['prisma'];
  let tx: ReturnType<typeof crearPrisma>['tx'];
  let servicio: DatosFacturacionService;

  beforeEach(() => {
    ({ prisma, tx } = crearPrisma());
    servicio = new DatosFacturacionService(prisma as unknown as PrismaService);
  });

  it('E9-H2 · varios registros: listar devuelve solo los activos de la cuenta del token', async () => {
    await servicio.listar(CODIGO);

    const consulta = prisma.datosFacturacion.findMany.mock.calls[0][0];
    expect(consulta.where).toEqual({
      usuario: { codigoPublico: CODIGO },
      activo: true,
    });
    expect(consulta.orderBy).toEqual({ id: 'asc' });
  });

  describe('crear', () => {
    it('E9-H2 · datos guardados: los agrega a la cuenta, con su comuna', async () => {
      await servicio.crear(CODIGO, dtoBase());

      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.comuna.findUnique.mock.calls[0][0].where).toEqual({
        codigoCut: '13123',
      });
      expect(tx.datosFacturacion.create.mock.calls[0][0].data).toMatchObject({
        usuarioId: 7,
        comunaId: 30,
        rut: '76086429-3',
        razonSocial: 'Peluquería Los Aromos SpA',
        giro: 'Servicios de peluquería',
        direccion: 'Av. Providencia 1234',
      });
    });

    it('una comuna inexistente responde 400 y no guarda nada', async () => {
      tx.comuna.findUnique.mockResolvedValue(null);

      await expect(servicio.crear(CODIGO, dtoBase())).rejects.toThrow(
        new BadRequestException('La comuna no existe.'),
      );
      expect(tx.datosFacturacion.create).not.toHaveBeenCalled();
    });
  });

  describe('actualizar', () => {
    it('cambia solo lo que viene, dentro de la cuenta y de los registros activos', async () => {
      await servicio.actualizar(CODIGO, 5, { giro: 'Comercio' });

      expect(tx.datosFacturacion.findFirst.mock.calls[0][0].where).toEqual({
        id: 5,
        usuarioId: 7,
        activo: true,
      });
      const { data } = tx.datosFacturacion.update.mock.calls[0][0];
      expect(data).toMatchObject({ giro: 'Comercio', comunaId: undefined });
      expect(tx.comuna.findUnique).not.toHaveBeenCalled();
    });

    it('una comuna nueva se busca antes de guardar', async () => {
      await servicio.actualizar(CODIGO, 5, { comuna: '13123' });

      expect(tx.datosFacturacion.update.mock.calls[0][0].data.comunaId).toBe(
        30,
      );
    });

    it('un registro de otra cuenta o ya eliminado responde 404 y no cambia', async () => {
      tx.datosFacturacion.findFirst.mockResolvedValue(null);

      await expect(
        servicio.actualizar(CODIGO, 99, { giro: 'Comercio' }),
      ).rejects.toThrow(
        new NotFoundException('Los datos de facturación no existen.'),
      );
      expect(tx.datosFacturacion.update).not.toHaveBeenCalled();
    });
  });

  describe('desactivar', () => {
    it('no borra el registro: lo marca inactivo, porque los pedidos lo referencian', async () => {
      await servicio.desactivar(CODIGO, 5);

      expect(tx.datosFacturacion.update.mock.calls[0][0]).toEqual({
        where: { id: 5 },
        data: { activo: false },
      });
    });

    it('un registro de otra cuenta o ya eliminado responde 404', async () => {
      tx.datosFacturacion.findFirst.mockResolvedValue(null);

      await expect(servicio.desactivar(CODIGO, 99)).rejects.toThrow(
        NotFoundException,
      );
      expect(tx.datosFacturacion.update).not.toHaveBeenCalled();
    });
  });
});
