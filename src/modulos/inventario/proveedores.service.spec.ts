import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CrearProveedorDto } from './dto/crear-proveedor.dto.js';
import { ProveedoresService } from './proveedores.service.js';

const crearPrisma = () => ({
  proveedor: {
    create: vi.fn().mockResolvedValue({ id: 1, activo: true }),
    findMany: vi.fn().mockResolvedValue([]),
  },
});

const dtoBase = (): CrearProveedorDto => ({
  rut: '76086428-5',
  razonSocial: 'Distribuidora Capilar SpA',
  nombreContacto: 'Marcela Soto',
  telefono: '+56412345678',
  email: 'ventas@distribuidora.cl',
});

const errorDeUnicidad = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'prueba',
  });

describe('ProveedoresService', () => {
  let prisma: ReturnType<typeof crearPrisma>;
  let servicio: ProveedoresService;

  beforeEach(() => {
    prisma = crearPrisma();
    servicio = new ProveedoresService(prisma as unknown as PrismaService);
  });

  describe('crear', () => {
    it('E11-H1 · RUT nuevo: registra el proveedor con sus datos', async () => {
      const creado = await servicio.crear(dtoBase());

      expect(prisma.proveedor.create).toHaveBeenCalledWith({
        data: {
          rut: '76086428-5',
          razonSocial: 'Distribuidora Capilar SpA',
          nombreContacto: 'Marcela Soto',
          telefono: '+56412345678',
          email: 'ventas@distribuidora.cl',
        },
      });
      expect(creado).toEqual({ id: 1, activo: true });
    });

    it('E11-H1 · RUT nuevo: los datos de contacto son opcionales', async () => {
      await servicio.crear({ rut: '12345678-5', razonSocial: 'Proveedor Uno' });

      expect(prisma.proveedor.create).toHaveBeenCalledWith({
        data: {
          rut: '12345678-5',
          razonSocial: 'Proveedor Uno',
          nombreContacto: undefined,
          telefono: undefined,
          email: undefined,
        },
      });
    });

    it('E11-H1 · RUT repetido: rechaza el registro con 409', async () => {
      prisma.proveedor.create.mockRejectedValue(errorDeUnicidad());

      await expect(servicio.crear(dtoBase())).rejects.toThrow(
        new ConflictException('Ya existe un proveedor con ese RUT.'),
      );
    });

    it('un error de la base que no es de unicidad no se disfraza de RUT repetido', async () => {
      prisma.proveedor.create.mockRejectedValue(new Error('conexión perdida'));

      await expect(servicio.crear(dtoBase())).rejects.toThrow(
        'conexión perdida',
      );
    });
  });

  describe('listar', () => {
    it('E11-H1 · queda disponible: por defecto lista solo los activos por razón social', async () => {
      await servicio.listar();

      expect(prisma.proveedor.findMany).toHaveBeenCalledWith({
        where: { activo: true },
        orderBy: { razonSocial: 'asc' },
      });
    });

    it('con incluirInactivos lista también los desactivados', async () => {
      await servicio.listar(true);

      expect(prisma.proveedor.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { razonSocial: 'asc' },
      });
    });
  });
});
