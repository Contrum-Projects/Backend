import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CrearPackDto } from './dto/crear-pack.dto.js';
import { PacksService } from './packs.service.js';

const fila = (extra: object = {}) => ({
  id: 30,
  nombre: 'Dúo reparador',
  descripcion: 'Shampoo y acondicionador.',
  canalVenta: 'general',
  fechaInicioVigencia: null,
  fechaFinVigencia: null,
  fechaCreacion: new Date('2026-10-26T12:00:00Z'),
  articulo: { sku: 'PACK-DUO', activo: true, imagenes: [] },
  componentes: [
    {
      cantidad: 2,
      formato: {
        id: 11,
        nombreFormato: '300 ml',
        articulo: { sku: 'SHA-300' },
        producto: { id: 5, nombre: 'Shampoo reparador' },
      },
    },
  ],
  ...extra,
});

/** Artículo tal como lo lee la revisión de componentes. */
const articulo = (id: number, extra: object = {}) => ({
  id,
  tipo: 'formato',
  activo: true,
  formato: { producto: { activo: true, canalVenta: 'general' } },
  ...extra,
});

const config = {
  get: vi.fn().mockReturnValue('https://imagenes.cabelloperfecto.cl'),
} as unknown as ConfigService<Entorno, true>;

const crearPrisma = () => {
  const prisma = {
    // El bloqueo de la fila del pack
    $queryRaw: vi.fn().mockResolvedValue([{ id: 30 }]),
    articuloVenta: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([articulo(11), articulo(12)]),
      create: vi.fn().mockResolvedValue({ id: 30 }),
      update: vi.fn().mockResolvedValue({ id: 30 }),
    },
    pack: {
      findUnique: vi.fn().mockResolvedValue({
        canalVenta: 'profesional',
        fechaInicioVigencia: new Date('2026-11-01T00:00:00Z'),
        fechaFinVigencia: null,
        componentes: [{ formatoId: 11, cantidad: 2 }],
      }),
      findMany: vi.fn().mockResolvedValue([fila()]),
      count: vi.fn().mockResolvedValue(1),
      create: vi.fn().mockResolvedValue(fila()),
      update: vi.fn().mockResolvedValue(fila()),
    },
    componentePack: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    existencia: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((trabajo: unknown) =>
    typeof trabajo === 'function'
      ? (trabajo as (tx: typeof prisma) => Promise<unknown>)(prisma)
      : Promise.all(trabajo as Promise<unknown>[]),
  );
  return prisma;
};

const datosNuevos = (extra: Partial<CrearPackDto> = {}): CrearPackDto => ({
  sku: 'PACK-DUO',
  nombre: 'Dúo reparador',
  descripcion: 'Shampoo y acondicionador.',
  canalVenta: 'general',
  componentes: [
    { formatoId: 11, cantidad: 1 },
    { formatoId: 12, cantidad: 1 },
  ],
  ...extra,
});

describe('PacksService', () => {
  let prisma: ReturnType<typeof crearPrisma>;
  let servicio: PacksService;

  beforeEach(() => {
    prisma = crearPrisma();
    servicio = new PacksService(prisma as unknown as PrismaService, config);
  });

  describe('crear', () => {
    it('E3-H6 · pack creado: guarda el artículo de tipo pack con su SKU, sin precios, y sus componentes', async () => {
      const creado = await servicio.crear(
        datosNuevos({
          fechaInicioVigencia: '2026-11-01',
          fechaFinVigencia: '2026-11-30',
        }),
      );

      expect(prisma.articuloVenta.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { sku: 'PACK-DUO', tipo: 'pack' },
        }),
      );
      expect(prisma.pack.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            id: 30,
            nombre: 'Dúo reparador',
            descripcion: 'Shampoo y acondicionador.',
            canalVenta: 'general',
            fechaInicioVigencia: new Date('2026-11-01T00:00:00Z'),
            fechaFinVigencia: new Date('2026-11-30T00:00:00Z'),
            componentes: {
              create: [
                { formatoId: 11, cantidad: 1 },
                { formatoId: 12, cantidad: 1 },
              ],
            },
          },
        }),
      );
      expect(creado).toMatchObject({
        id: 30,
        sku: 'PACK-DUO',
        vigente: true,
        activo: true,
        componentes: [
          {
            formatoId: 11,
            sku: 'SHA-300',
            nombreFormato: '300 ml',
            producto: { id: 5, nombre: 'Shampoo reparador' },
            cantidad: 2,
          },
        ],
      });
    });

    it('E3-H6 · pack creado: no tiene stock propio, no crea existencias', async () => {
      await servicio.crear(datosNuevos());

      expect(prisma.existencia.create).not.toHaveBeenCalled();
    });

    it('E3-H6 · componente no permitido: otro pack como componente se rechaza y no se crea nada', async () => {
      prisma.articuloVenta.findMany.mockResolvedValue([
        articulo(11),
        { id: 40, tipo: 'pack', activo: true, formato: null },
      ]);

      await expect(
        servicio.crear(
          datosNuevos({
            componentes: [
              { formatoId: 11, cantidad: 1 },
              { formatoId: 40, cantidad: 1 },
            ],
          }),
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Un pack solo admite formatos de producto como componentes, no otros packs.',
        ),
      );
      expect(prisma.articuloVenta.create).not.toHaveBeenCalled();
      expect(prisma.pack.create).not.toHaveBeenCalled();
    });

    it('rechaza un formato que no existe o está desactivado', async () => {
      prisma.articuloVenta.findMany.mockResolvedValue([articulo(11)]);
      await expect(servicio.crear(datosNuevos())).rejects.toThrow(
        new BadRequestException('El formato con id 12 no existe.'),
      );

      prisma.articuloVenta.findMany.mockResolvedValue([
        articulo(11),
        articulo(12, {
          formato: { producto: { activo: false, canalVenta: 'general' } },
        }),
      ]);
      await expect(servicio.crear(datosNuevos())).rejects.toThrow(
        new BadRequestException(
          'El formato con id 12 no está activo o su producto fue desactivado.',
        ),
      );

      prisma.articuloVenta.findMany.mockResolvedValue([
        articulo(11, { activo: false }),
        articulo(12),
      ]);
      await expect(servicio.crear(datosNuevos())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('un pack general no lleva formatos de productos exclusivos; uno profesional sí', async () => {
      prisma.articuloVenta.findMany.mockResolvedValue([
        articulo(11),
        articulo(12, {
          formato: { producto: { activo: true, canalVenta: 'profesional' } },
        }),
      ]);

      await expect(servicio.crear(datosNuevos())).rejects.toThrow(
        new BadRequestException(
          'Un pack de venta general no puede llevar el formato con id 12: su producto es exclusivo para profesionales.',
        ),
      );
      await expect(
        servicio.crear(datosNuevos({ canalVenta: 'profesional' })),
      ).resolves.toMatchObject({ id: 30 });
    });

    it('rechaza una vigencia que termina antes de empezar', async () => {
      await expect(
        servicio.crear(
          datosNuevos({
            fechaInicioVigencia: '2026-11-30',
            fechaFinVigencia: '2026-11-01',
          }),
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'La fecha de término de la vigencia no puede ser anterior a la de inicio.',
        ),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('responde 409 si el SKU ya pertenece a otro artículo', async () => {
      prisma.articuloVenta.findFirst.mockResolvedValue({ id: 11 });

      await expect(servicio.crear(datosNuevos())).rejects.toThrow(
        new ConflictException('El SKU ya pertenece a otro artículo.'),
      );
    });

    it('dos guardados simultáneos con el mismo SKU: el segundo recibe 409', async () => {
      prisma.pack.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(servicio.crear(datosNuevos())).rejects.toThrow(
        new ConflictException('El SKU ya pertenece a otro artículo.'),
      );
    });
  });

  describe('actualizar', () => {
    it('E3-H6 · componente no permitido: también se rechaza al editar los componentes', async () => {
      prisma.articuloVenta.findMany.mockResolvedValue([
        { id: 40, tipo: 'pack', activo: true, formato: null },
        articulo(11),
      ]);

      await expect(
        servicio.actualizar(30, {
          componentes: [
            { formatoId: 40, cantidad: 1 },
            { formatoId: 11, cantidad: 1 },
          ],
        }),
      ).rejects.toThrow(
        'Un pack solo admite formatos de producto como componentes, no otros packs.',
      );
      expect(prisma.componentePack.deleteMany).not.toHaveBeenCalled();
      expect(prisma.pack.update).not.toHaveBeenCalled();
    });

    it('reemplaza los componentes con la fila del pack bloqueada', async () => {
      await servicio.actualizar(30, {
        componentes: [{ formatoId: 12, cantidad: 3 }],
      });

      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.componentePack.deleteMany).toHaveBeenCalledWith({
        where: { packId: 30 },
      });
      expect(prisma.pack.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            componentes: { create: [{ formatoId: 12, cantidad: 3 }] },
          }) as object,
        }),
      );
    });

    it('al pasar a general revisa los componentes que ya tiene', async () => {
      prisma.articuloVenta.findMany.mockResolvedValue([
        articulo(11, {
          formato: { producto: { activo: true, canalVenta: 'profesional' } },
        }),
      ]);

      await expect(
        servicio.actualizar(30, { canalVenta: 'general' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.articuloVenta.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: [11] } } }),
      );
    });

    it('solo cambia lo que llega; sin canal ni componentes no los revisa', async () => {
      await servicio.actualizar(30, {
        nombre: 'Trío reparador',
        fechaFinVigencia: null,
      });

      expect(prisma.articuloVenta.findMany).not.toHaveBeenCalled();
      expect(prisma.componentePack.deleteMany).not.toHaveBeenCalled();
      expect(prisma.pack.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            nombre: 'Trío reparador',
            descripcion: undefined,
            canalVenta: undefined,
            fechaInicioVigencia: undefined,
            fechaFinVigencia: null,
            componentes: undefined,
          },
        }),
      );
    });

    it('compara la vigencia nueva con la guardada', async () => {
      // El pack guardado empieza el 2026-11-01
      await expect(
        servicio.actualizar(30, { fechaFinVigencia: '2026-10-31' }),
      ).rejects.toThrow(
        'La fecha de término de la vigencia no puede ser anterior a la de inicio.',
      );
    });

    it('cambia el SKU del artículo si está libre', async () => {
      await servicio.actualizar(30, { sku: 'PACK-TRIO' });

      expect(prisma.articuloVenta.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sku: 'PACK-TRIO', id: { not: 30 } },
        }),
      );
      expect(prisma.articuloVenta.update).toHaveBeenCalledWith({
        where: { id: 30 },
        data: { sku: 'PACK-TRIO' },
      });
    });

    it('bloquea el artículo antes que el pack, como al fijar precios', async () => {
      await servicio.actualizar(30, { nombre: 'Trío reparador' });

      const consultas = prisma.$queryRaw.mock.calls.map((llamada) =>
        (llamada[0] as TemplateStringsArray).join('?'),
      );
      expect(consultas[0]).toContain('FROM articulo_venta');
      expect(consultas[1]).toContain('FROM pack');
    });

    it('un choque de unicidad sin SKU en el cuerpo no se informa como SKU repetido', async () => {
      const choque = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: 'test' },
      );
      prisma.pack.update.mockRejectedValue(choque);

      await expect(
        servicio.actualizar(30, { nombre: 'Trío reparador' }),
      ).rejects.toBe(choque);
    });

    it('rechaza un cuerpo vacío y un pack que no existe', async () => {
      await expect(servicio.actualizar(30, {})).rejects.toThrow(
        new BadRequestException('Indica al menos un campo para cambiar.'),
      );

      prisma.$queryRaw.mockResolvedValue([]);
      await expect(servicio.actualizar(99, { nombre: 'Otro' })).rejects.toThrow(
        new NotFoundException('El pack no existe.'),
      );
    });
  });

  describe('listar y obtener', () => {
    it('lista los packs paginados con su vigencia de hoy', async () => {
      prisma.pack.findMany.mockResolvedValue([
        fila({ fechaFinVigencia: new Date('2020-01-31T00:00:00Z') }),
      ]);

      const listado = await servicio.listar({ pagina: 2, limite: 10 });

      expect(prisma.pack.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
      expect(listado).toMatchObject({
        total: 1,
        pagina: 2,
        limite: 10,
        items: [{ id: 30, fechaFinVigencia: '2020-01-31', vigente: false }],
      });
    });

    it('responde 404 si el pack no existe', async () => {
      prisma.pack.findUnique.mockResolvedValue(null);

      await expect(servicio.obtener(99)).rejects.toThrow(
        new NotFoundException('El pack no existe.'),
      );
    });
  });
});
