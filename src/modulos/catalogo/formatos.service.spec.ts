import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CrearFormatoDto } from './dto/crear-formato.dto.js';
import { FormatosService } from './formatos.service.js';

const fila = (extra: object = {}) => ({
  id: 11,
  productoId: 5,
  codigoBarras: '7801234567890',
  nombreFormato: '300 ml',
  contenido: new Prisma.Decimal(300),
  unidadMedida: 'ml',
  fechaVencimiento: null,
  stockMinimo: 5,
  pesoGramos: 320,
  altoCm: new Prisma.Decimal('18.5'),
  anchoCm: new Prisma.Decimal(6),
  largoCm: new Prisma.Decimal(4),
  esPredeterminado: true,
  articulo: { sku: 'SHA-REP-300', activo: true },
  ...extra,
});

const crearPrisma = () => {
  const prisma = {
    // Primera consulta: el bloqueo del producto (o del producto del formato)
    $queryRaw: vi.fn().mockResolvedValue([{ id: 5 }]),
    producto: { findUnique: vi.fn().mockResolvedValue({ id: 5 }) },
    articuloVenta: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 11 }),
      update: vi.fn().mockResolvedValue({ id: 11 }),
    },
    formatoProducto: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue({ esPredeterminado: false }),
      findMany: vi.fn().mockResolvedValue([fila()]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue(fila()),
      update: vi.fn().mockResolvedValue(fila()),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(
    (trabajo: (tx: typeof prisma) => Promise<unknown>) => trabajo(prisma),
  );
  return prisma;
};

const datosNuevos = (
  extra: Partial<CrearFormatoDto> = {},
): CrearFormatoDto => ({
  sku: 'SHA-REP-300',
  codigoBarras: '7801234567890',
  nombreFormato: '300 ml',
  contenido: 300,
  unidadMedida: 'ml',
  stockMinimo: 5,
  pesoGramos: 320,
  altoCm: 18.5,
  anchoCm: 6,
  largoCm: 4,
  ...extra,
});

const errorUnico = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

describe('FormatosService', () => {
  let prisma: ReturnType<typeof crearPrisma>;
  let servicio: FormatosService;

  beforeEach(() => {
    prisma = crearPrisma();
    servicio = new FormatosService(prisma as unknown as PrismaService);
  });

  describe('crear', () => {
    it('E3-H2 · formato creado: se agrega al producto con sus datos, como artículo de tipo formato y sin precios', async () => {
      const creado = await servicio.crear(5, datosNuevos());

      expect(prisma.articuloVenta.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { sku: 'SHA-REP-300', tipo: 'formato' },
        }),
      );
      expect(prisma.formatoProducto.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            id: 11,
            productoId: 5,
            codigoBarras: '7801234567890',
            nombreFormato: '300 ml',
            contenido: 300,
            unidadMedida: 'ml',
            fechaVencimiento: null,
            stockMinimo: 5,
            pesoGramos: 320,
            altoCm: 18.5,
            anchoCm: 6,
            largoCm: 4,
            esPredeterminado: true,
          },
        }),
      );
      expect(creado).toEqual({
        id: 11,
        productoId: 5,
        sku: 'SHA-REP-300',
        codigoBarras: '7801234567890',
        nombreFormato: '300 ml',
        contenido: 300,
        unidadMedida: 'ml',
        fechaVencimiento: null,
        stockMinimo: 5,
        pesoGramos: 320,
        altoCm: 18.5,
        anchoCm: 6,
        largoCm: 4,
        esPredeterminado: true,
        activo: true,
      });
    });

    it('E3-H2 · formato creado: bloquea la fila del producto antes de contar sus formatos', async () => {
      await servicio.crear(5, datosNuevos());

      const consulta = (
        prisma.$queryRaw.mock.calls[0][0] as TemplateStringsArray
      ).join('');
      expect(consulta).toMatch(/FROM producto/);
      expect(consulta).toMatch(/FOR UPDATE/);
    });

    it('E3-H2 · formato creado: sin código de barras ni contenido, el stock mínimo queda en 0', async () => {
      await servicio.crear(
        5,
        datosNuevos({
          codigoBarras: undefined,
          contenido: undefined,
          unidadMedida: undefined,
          stockMinimo: undefined,
        }),
      );

      expect(prisma.formatoProducto.findFirst).not.toHaveBeenCalled();
      expect(prisma.formatoProducto.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            codigoBarras: null,
            contenido: null,
            unidadMedida: null,
            stockMinimo: 0,
          }),
        }),
      );
    });

    it('E3-H2 · producto inexistente: responde 404 y no guarda nada', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(servicio.crear(99, datosNuevos())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.articuloVenta.create).not.toHaveBeenCalled();
    });

    it('E3-H2 · contenido sin unidad de medida (o al revés): rechaza con 400', async () => {
      await expect(
        servicio.crear(5, datosNuevos({ unidadMedida: undefined })),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        servicio.crear(5, datosNuevos({ contenido: null })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.articuloVenta.create).not.toHaveBeenCalled();
    });

    it('E3-H2 · SKU repetido: rechaza con 409, indica el SKU y no guarda nada', async () => {
      prisma.articuloVenta.findFirst.mockResolvedValue({ id: 3 });

      const error = await servicio
        .crear(5, datosNuevos())
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(
        'El SKU ya pertenece a otro artículo.',
      );
      expect(prisma.articuloVenta.create).not.toHaveBeenCalled();
    });

    it('E3-H2 · código de barras repetido: rechaza con 409 e indica el código de barras', async () => {
      prisma.formatoProducto.findFirst.mockResolvedValue({ id: 4 });

      await expect(servicio.crear(5, datosNuevos())).rejects.toThrow(
        new ConflictException(
          'El código de barras ya pertenece a otro artículo.',
        ),
      );
      expect(prisma.articuloVenta.create).not.toHaveBeenCalled();
    });

    it('E3-H2 · SKU y código de barras repetidos: el mensaje indica los dos', async () => {
      prisma.articuloVenta.findFirst.mockResolvedValue({ id: 3 });
      prisma.formatoProducto.findFirst.mockResolvedValue({ id: 4 });

      await expect(servicio.crear(5, datosNuevos())).rejects.toThrow(
        'El SKU y el código de barras ya pertenecen a otro artículo.',
      );
    });

    it('E3-H2 · SKU guardado a la vez por otra petición (P2002): vuelve a revisar e indica el dato repetido', async () => {
      prisma.articuloVenta.create.mockRejectedValue(errorUnico());
      // Libre al revisar dentro de la transacción; ocupado al revisar de nuevo tras el choque
      prisma.articuloVenta.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 3 });

      await expect(servicio.crear(5, datosNuevos())).rejects.toThrow(
        new ConflictException('El SKU ya pertenece a otro artículo.'),
      );
    });

    it('E3-H2 · fecha de vencimiento opcional: se guarda como fecha y se devuelve en AAAA-MM-DD', async () => {
      prisma.formatoProducto.create.mockResolvedValue(
        fila({ fechaVencimiento: new Date('2027-12-31T00:00:00Z') }),
      );

      const creado = await servicio.crear(
        5,
        datosNuevos({ fechaVencimiento: '2027-12-31' }),
      );

      expect(prisma.formatoProducto.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fechaVencimiento: new Date('2027-12-31T00:00:00Z'),
          }),
        }),
      );
      expect(creado.fechaVencimiento).toBe('2027-12-31');
    });

    it('E3-H2 · formato predeterminado: el primer formato del producto queda predeterminado aunque no se pida', async () => {
      prisma.formatoProducto.count.mockResolvedValue(0);

      await servicio.crear(5, datosNuevos({ esPredeterminado: false }));

      expect(prisma.formatoProducto.updateMany).not.toHaveBeenCalled();
      expect(prisma.formatoProducto.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ esPredeterminado: true }),
        }),
      );
    });

    it('E3-H2 · formato predeterminado: con otros formatos, uno nuevo sin marcar no cambia el predeterminado', async () => {
      prisma.formatoProducto.count.mockResolvedValue(2);

      await servicio.crear(5, datosNuevos());

      expect(prisma.formatoProducto.updateMany).not.toHaveBeenCalled();
      expect(prisma.formatoProducto.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ esPredeterminado: false }),
        }),
      );
    });

    it('E3-H2 · formato predeterminado: un nuevo formato marcado desmarca a los demás del producto', async () => {
      prisma.formatoProducto.count.mockResolvedValue(2);

      await servicio.crear(5, datosNuevos({ esPredeterminado: true }));

      expect(prisma.formatoProducto.updateMany).toHaveBeenCalledWith({
        where: { productoId: 5, esPredeterminado: true },
        data: { esPredeterminado: false },
      });
      expect(prisma.formatoProducto.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ esPredeterminado: true }),
        }),
      );
    });
  });

  describe('actualizar', () => {
    beforeEach(() => {
      prisma.$queryRaw.mockResolvedValue([{ productoId: 5 }]);
    });

    it('E3-H2 · formato predeterminado: marcar uno lo deja como el único predeterminado del producto', async () => {
      await servicio.actualizar(11, { esPredeterminado: true });

      expect(prisma.formatoProducto.updateMany).toHaveBeenCalledWith({
        where: { productoId: 5, esPredeterminado: true, id: { not: 11 } },
        data: { esPredeterminado: false },
      });
      expect(prisma.formatoProducto.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 11 },
          data: expect.objectContaining({ esPredeterminado: true }),
        }),
      );
    });

    it('E3-H2 · formato predeterminado: no se puede desmarcar el predeterminado (400)', async () => {
      prisma.formatoProducto.findUnique.mockResolvedValue({
        esPredeterminado: true,
      });

      await expect(
        servicio.actualizar(11, { esPredeterminado: false }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.formatoProducto.update).not.toHaveBeenCalled();
    });

    it('E3-H2 · cambia solo lo que llega; null borra la fecha de vencimiento y el código de barras', async () => {
      await servicio.actualizar(11, {
        nombreFormato: '500 ml',
        fechaVencimiento: null,
        codigoBarras: null,
      });

      expect(prisma.articuloVenta.update).not.toHaveBeenCalled();
      expect(prisma.formatoProducto.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            nombreFormato: '500 ml',
            fechaVencimiento: null,
            codigoBarras: null,
            contenido: undefined,
            unidadMedida: undefined,
            stockMinimo: undefined,
            pesoGramos: undefined,
            altoCm: undefined,
            anchoCm: undefined,
            largoCm: undefined,
            esPredeterminado: undefined,
          },
        }),
      );
    });

    it('E3-H2 · SKU nuevo: se guarda en el artículo y se compara con los demás artículos', async () => {
      await servicio.actualizar(11, { sku: 'SHA-REP-500' });

      expect(prisma.articuloVenta.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sku: 'SHA-REP-500', id: { not: 11 } },
        }),
      );
      expect(prisma.articuloVenta.update).toHaveBeenCalledWith({
        where: { id: 11 },
        data: { sku: 'SHA-REP-500' },
      });
    });

    it('E3-H2 · SKU o código de barras repetido al editar: rechaza con 409 y no cambia nada', async () => {
      prisma.formatoProducto.findFirst.mockResolvedValue({ id: 4 });

      await expect(
        servicio.actualizar(11, { codigoBarras: '78012345' }),
      ).rejects.toThrow('El código de barras ya pertenece a otro artículo.');
      expect(prisma.formatoProducto.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { codigoBarras: '78012345', id: { not: 11 } },
        }),
      );
      expect(prisma.formatoProducto.update).not.toHaveBeenCalled();
    });

    it('E3-H2 · formato inexistente: responde 404', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(
        servicio.actualizar(99, { nombreFormato: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('E3-H2 · cuerpo vacío o contenido sin su unidad: rechaza con 400', async () => {
      await expect(servicio.actualizar(11, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        servicio.actualizar(11, { contenido: 500 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('listar', () => {
    it('E3-H2 · fecha de vencimiento: el listado del panel la devuelve, con el predeterminado primero', async () => {
      prisma.formatoProducto.findMany.mockResolvedValue([
        fila({ fechaVencimiento: new Date('2027-12-31T00:00:00Z') }),
      ]);

      const formatos = await servicio.listar(5);

      expect(prisma.formatoProducto.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { productoId: 5 },
          orderBy: [{ esPredeterminado: 'desc' }, { id: 'asc' }],
        }),
      );
      expect(formatos[0].fechaVencimiento).toBe('2027-12-31');
    });

    it('E3-H2 · producto inexistente: responde 404', async () => {
      prisma.producto.findUnique.mockResolvedValue(null);

      await expect(servicio.listar(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
