import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { PreciosService } from './precios.service.js';

const USUARIO = 'c7a1d1f4-0000-4000-8000-000000000001';
const FIJADO_POR = {
  nombre: 'Marcela',
  apellido: 'Soto',
};

interface Articulo {
  minorista?: string | null;
  mayorista?: string | null;
  canal?: string;
  esPack?: boolean;
}

const articulo = ({
  minorista = null,
  mayorista = null,
  canal = 'general',
  esPack = false,
}: Articulo = {}) => ({
  id: 11,
  precioMinoristaNeto: minorista,
  precioMayoristaNeto: mayorista,
  formato: esPack ? null : { productoId: 5, producto: { canalVenta: canal } },
  pack: esPack ? { canalVenta: canal } : null,
  historialPrecio: [],
});

const crearPrisma = (datos: Articulo = {}) => {
  const fila = articulo(datos);
  const prisma = {
    // El bloqueo del artículo: [] cuando no existe
    $queryRaw: vi.fn().mockResolvedValue([{ id: 11 }]),
    articuloVenta: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(fila),
      findUnique: vi.fn().mockResolvedValue(fila),
      update: vi.fn().mockResolvedValue({}),
    },
    usuario: { findUnique: vi.fn().mockResolvedValue({ id: 3 }) },
    historialPrecio: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(
    (trabajo: (tx: typeof prisma) => Promise<unknown>) => trabajo(prisma),
  );
  return prisma;
};

describe('PreciosService', () => {
  let prisma: ReturnType<typeof crearPrisma>;
  let servicio: PreciosService;

  const preparar = (datos?: Articulo) => {
    prisma = crearPrisma(datos);
    servicio = new PreciosService(prisma as unknown as PrismaService);
  };

  beforeEach(() => preparar());

  describe('fijar', () => {
    it('E3-H5 · cambio de precio: aplica el nuevo neto y guarda en el historial su vigencia, quién lo fijó y el motivo', async () => {
      preparar({ minorista: '10000.00', mayorista: '8000.00' });

      await servicio.fijar(
        11,
        { precioMinoristaNeto: 10500, motivo: 'Alza del proveedor' },
        USUARIO,
      );

      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.usuario.findUnique).toHaveBeenCalledWith({
        where: { codigoPublico: USUARIO },
        select: { id: true },
      });
      const [cierre] = prisma.historialPrecio.updateMany.mock.calls[0] as [
        { data: { fechaFinVigencia: Date } },
      ];
      expect(prisma.historialPrecio.updateMany).toHaveBeenCalledWith({
        where: {
          articuloId: 11,
          tipoPrecio: 'minorista',
          fechaFinVigencia: null,
        },
        data: { fechaFinVigencia: expect.any(Date) as Date },
      });
      expect(prisma.historialPrecio.create).toHaveBeenCalledWith({
        data: {
          articuloId: 11,
          usuarioId: 3,
          tipoPrecio: 'minorista',
          precioNeto: 10500,
          // El nuevo precio rige desde el mismo instante en que se cierra el anterior
          fechaInicioVigencia: cierre.data.fechaFinVigencia,
          motivo: 'Alza del proveedor',
        },
      });
      expect(prisma.articuloVenta.update).toHaveBeenCalledWith({
        where: { id: 11 },
        data: { precioMinoristaNeto: 10500 },
      });
    });

    it('E3-H5 · cambio de precio: con los dos precios registra un cambio por cada uno', async () => {
      await servicio.fijar(
        11,
        {
          precioMinoristaNeto: 10000,
          precioMayoristaNeto: 7999.99,
          motivo: 'Precios iniciales',
        },
        USUARIO,
      );

      expect(prisma.historialPrecio.create).toHaveBeenCalledTimes(2);
      expect(prisma.articuloVenta.update).toHaveBeenCalledWith({
        where: { id: 11 },
        data: { precioMinoristaNeto: 10000, precioMayoristaNeto: 7999.99 },
      });
    });

    it('E3-H5 · cambio de precio: un precio igual al vigente no se registra', async () => {
      preparar({ minorista: '10000.00', mayorista: '8000.00' });

      await servicio.fijar(
        11,
        {
          precioMinoristaNeto: 10000,
          precioMayoristaNeto: 7500,
          motivo: 'Baja del mayorista',
        },
        USUARIO,
      );

      expect(prisma.historialPrecio.create).toHaveBeenCalledTimes(1);
      expect(prisma.historialPrecio.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tipoPrecio: 'mayorista',
          precioNeto: 7500,
        }) as object,
      });
      expect(prisma.articuloVenta.update).toHaveBeenCalledWith({
        where: { id: 11 },
        data: { precioMayoristaNeto: 7500 },
      });
    });

    it('E3-H5 · cambio de precio: si ningún precio cambia no escribe nada', async () => {
      preparar({ minorista: '10000.00', mayorista: '8000.00' });

      await servicio.fijar(
        11,
        { precioMinoristaNeto: 10000, motivo: 'Sin cambio' },
        USUARIO,
      );

      expect(prisma.historialPrecio.updateMany).not.toHaveBeenCalled();
      expect(prisma.historialPrecio.create).not.toHaveBeenCalled();
      expect(prisma.articuloVenta.update).not.toHaveBeenCalled();
    });

    it('E3-H5 · cambio de precio: sin ningún precio responde 400', async () => {
      await expect(
        servicio.fijar(11, { motivo: 'Nada' }, USUARIO),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('E3-H5 · artículo exclusivo para profesionales: exige solo el precio mayorista', async () => {
      preparar({ canal: 'profesional' });

      await servicio.fijar(
        11,
        { precioMayoristaNeto: 7000, motivo: 'Precio inicial' },
        USUARIO,
      );

      expect(prisma.articuloVenta.update).toHaveBeenCalledWith({
        where: { id: 11 },
        data: { precioMayoristaNeto: 7000 },
      });
    });

    it('E3-H5 · artículo exclusivo para profesionales: rechaza el precio minorista (400)', async () => {
      preparar({ canal: 'profesional' });

      await expect(
        servicio.fijar(
          11,
          {
            precioMinoristaNeto: 9000,
            precioMayoristaNeto: 7000,
            motivo: 'Precio inicial',
          },
          USUARIO,
        ),
      ).rejects.toThrow(/exclusivo para profesionales/);
      expect(prisma.historialPrecio.create).not.toHaveBeenCalled();
      expect(prisma.articuloVenta.update).not.toHaveBeenCalled();
    });

    it('E3-H5 · pack exclusivo para profesionales: también rechaza el precio minorista', async () => {
      preparar({ canal: 'profesional', esPack: true });

      await expect(
        servicio.fijar(
          11,
          { precioMinoristaNeto: 9000, motivo: 'Precio inicial' },
          USUARIO,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('E3-H5 · artículo inexistente: responde 404', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(
        servicio.fijar(
          99,
          { precioMinoristaNeto: 1000, motivo: 'Prueba' },
          USUARIO,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('E3-H5 · cuenta del token inexistente: responde 401 sin escribir', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);

      await expect(
        servicio.fijar(
          11,
          { precioMinoristaNeto: 1000, motivo: 'Prueba' },
          USUARIO,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.historialPrecio.create).not.toHaveBeenCalled();
    });
  });

  describe('listar', () => {
    it('E3-H5 · devuelve los precios netos vigentes, si es exclusivo y el historial con quién y el motivo', async () => {
      const inicio = new Date('2026-10-24T12:00:00Z');
      prisma.articuloVenta.findUnique.mockResolvedValue({
        ...articulo({ minorista: '10500.00', mayorista: '8000.00' }),
        historialPrecio: [
          {
            id: 2,
            tipoPrecio: 'minorista',
            precioNeto: '10500.00',
            fechaInicioVigencia: inicio,
            fechaFinVigencia: null,
            motivo: 'Alza del proveedor',
            usuario: FIJADO_POR,
          },
        ],
      });

      expect(await servicio.listar(11)).toEqual({
        articuloId: 11,
        exclusivo: false,
        precioMinoristaNeto: 10500,
        precioMayoristaNeto: 8000,
        historial: [
          {
            id: 2,
            tipoPrecio: 'minorista',
            precioNeto: 10500,
            fechaInicioVigencia: inicio,
            fechaFinVigencia: null,
            motivo: 'Alza del proveedor',
            fijadoPor: FIJADO_POR,
          },
        ],
      });
    });

    it('E3-H5 · artículo inexistente: responde 404', async () => {
      prisma.articuloVenta.findUnique.mockResolvedValue(null);

      await expect(servicio.listar(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
