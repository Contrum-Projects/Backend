import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ROLES } from '../../common/dominio/roles.js';
import { ESTADOS_SOLICITUD } from '../../common/dominio/valores.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { MiCuentaService } from './mi-cuenta.service.js';

const CODIGO = '3f0c2a52-0b9e-4c55-9d0e-6a3a4f6d1b2c';

const usuarioGuardado = {
  codigoPublico: CODIGO,
  nombre: 'Camila',
  apellido: 'Rojas',
  email: 'camila@correo.cl',
  rut: '12345678-5',
  telefono: null,
  fechaNacimiento: new Date('1990-05-21T00:00:00Z'),
  genero: null,
};

const crearPrisma = () => {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 7 }]),
    usuario: {
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    solicitudVerificacion: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const prisma = {
    usuario: { findUnique: vi.fn() },
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { prisma, tx };
};

describe('MiCuentaService', () => {
  let prisma: ReturnType<typeof crearPrisma>['prisma'];
  let tx: ReturnType<typeof crearPrisma>['tx'];
  let servicio: MiCuentaService;

  const cuentaConRol = (rol: string, rut: string | null = '12345678-5') =>
    tx.usuario.findUniqueOrThrow.mockResolvedValue({ rol, rut });

  beforeEach(() => {
    ({ prisma, tx } = crearPrisma());
    servicio = new MiCuentaService(prisma as unknown as PrismaService);
  });

  describe('obtener', () => {
    it('devuelve los datos con la fecha como AAAA-MM-DD y sin el id', async () => {
      prisma.usuario.findUnique.mockResolvedValue(usuarioGuardado);

      const datos = await servicio.obtener(CODIGO);

      expect(datos).toEqual({
        ...usuarioGuardado,
        fechaNacimiento: '1990-05-21',
      });
      expect(
        prisma.usuario.findUnique.mock.calls[0][0].select,
      ).not.toHaveProperty('id');
    });

    it('responde 404 si la cuenta no existe', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);
      await expect(servicio.obtener(CODIGO)).rejects.toThrow(NotFoundException);
    });
  });

  describe('actualizar', () => {
    it('E1-H5 · actualización de datos: guarda los cambios y devuelve la cuenta actualizada', async () => {
      cuentaConRol(ROLES.CLIENTE);
      tx.usuario.update.mockResolvedValue({
        ...usuarioGuardado,
        nombre: 'Camila Andrea',
        telefono: '+56912345678',
        fechaNacimiento: new Date('1991-01-02T00:00:00Z'),
      });

      const datos = await servicio.actualizar(CODIGO, {
        nombre: 'Camila Andrea',
        telefono: '+56912345678',
        fechaNacimiento: '1991-01-02',
      });

      const { where, data } = tx.usuario.update.mock.calls[0][0];
      expect(where).toEqual({ id: 7 });
      expect(data).toEqual({
        nombre: 'Camila Andrea',
        apellido: undefined,
        telefono: '+56912345678',
        rut: undefined,
        fechaNacimiento: new Date('1991-01-02T00:00:00Z'),
        genero: undefined,
      });
      expect(datos).toMatchObject({
        nombre: 'Camila Andrea',
        telefono: '+56912345678',
        fechaNacimiento: '1991-01-02',
      });
    });

    it('borra los datos opcionales que llegan como null', async () => {
      cuentaConRol(ROLES.CLIENTE);
      tx.usuario.update.mockResolvedValue({
        ...usuarioGuardado,
        rut: null,
        fechaNacimiento: null,
      });

      await servicio.actualizar(CODIGO, { rut: null, fechaNacimiento: null });

      expect(tx.usuario.update.mock.calls[0][0].data).toMatchObject({
        rut: null,
        fechaNacimiento: null,
      });
      expect(tx.usuario.findFirst).not.toHaveBeenCalled();
    });

    it('E1-H5 · RUT de otra cuenta: rechaza el cambio e informa que el RUT ya está en uso', async () => {
      cuentaConRol(ROLES.CLIENTE);
      tx.usuario.findFirst.mockResolvedValue({ id: 8 });

      const promesa = servicio.actualizar(CODIGO, { rut: '11111111-1' });

      await expect(promesa).rejects.toThrow(ConflictException);
      await expect(promesa).rejects.toThrow(/RUT ya está en uso/);
      expect(tx.usuario.findFirst.mock.calls[0][0].where).toEqual({
        rut: '11111111-1',
        NOT: { id: 7 },
      });
      expect(tx.usuario.update).not.toHaveBeenCalled();
    });

    it('E1-H5 · RUT de otra cuenta: si otra cuenta lo guarda al mismo tiempo, también responde 409', async () => {
      cuentaConRol(ROLES.CLIENTE);
      tx.usuario.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('único', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        servicio.actualizar(CODIGO, { rut: '11111111-1' }),
      ).rejects.toThrow(/RUT ya está en uso/);
    });

    it('guardar el mismo RUT que ya tiene no lo compara con otras cuentas', async () => {
      cuentaConRol(ROLES.PROFESIONAL);
      tx.usuario.update.mockResolvedValue(usuarioGuardado);

      await servicio.actualizar(CODIGO, { rut: '12345678-5', nombre: 'Ana' });

      expect(tx.usuario.findFirst).not.toHaveBeenCalled();
      expect(tx.usuario.update).toHaveBeenCalled();
    });

    it('el profesional no puede cambiar ni borrar su RUT', async () => {
      for (const rut of ['11111111-1', null]) {
        cuentaConRol(ROLES.PROFESIONAL);
        await expect(servicio.actualizar(CODIGO, { rut })).rejects.toThrow(
          ForbiddenException,
        );
      }
      expect(tx.usuario.update).not.toHaveBeenCalled();
    });

    it('rechaza una fecha de nacimiento futura', async () => {
      cuentaConRol(ROLES.CLIENTE);
      await expect(
        servicio.actualizar(CODIGO, { fechaNacimiento: '2999-01-01' }),
      ).rejects.toThrow(BadRequestException);
      expect(tx.usuario.update).not.toHaveBeenCalled();
    });

    it('lee y guarda con la cuenta bloqueada', async () => {
      cuentaConRol(ROLES.CLIENTE);
      tx.usuario.update.mockResolvedValue(usuarioGuardado);

      await servicio.actualizar(CODIGO, { nombre: 'Ana' });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.usuario.findUniqueOrThrow.mock.calls[0][0].where).toEqual({
        id: 7,
      });
    });

    it('con una verificación profesional en curso no cambia ni borra el RUT', async () => {
      for (const rut of ['11111111-1', null]) {
        cuentaConRol(ROLES.CLIENTE);
        tx.solicitudVerificacion.findFirst.mockResolvedValue({ id: 3 });
        await expect(servicio.actualizar(CODIGO, { rut })).rejects.toThrow(
          /verificación profesional en curso/,
        );
      }
      expect(tx.solicitudVerificacion.findFirst.mock.calls[0][0].where).toEqual(
        {
          solicitanteId: 7,
          estado: {
            in: [
              ESTADOS_SOLICITUD.PENDIENTE,
              ESTADOS_SOLICITUD.REVISION_MANUAL,
            ],
          },
        },
      );
      expect(tx.usuario.update).not.toHaveBeenCalled();
    });

    it('sin verificación en curso (ninguna o ya resuelta) el cliente sí cambia su RUT', async () => {
      cuentaConRol(ROLES.CLIENTE);
      tx.usuario.update.mockResolvedValue(usuarioGuardado);

      await servicio.actualizar(CODIGO, { rut: '11111111-1' });

      expect(tx.usuario.update.mock.calls[0][0].data.rut).toBe('11111111-1');
    });

    it('responde 404 si la cuenta no existe', async () => {
      tx.$queryRaw.mockResolvedValue([]);
      await expect(
        servicio.actualizar(CODIGO, { nombre: 'Ana' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
