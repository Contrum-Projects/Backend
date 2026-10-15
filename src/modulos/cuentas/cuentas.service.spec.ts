import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import argon2 from 'argon2';
import type { Queue } from 'bullmq';
import { PRIORIDAD_CORREO, TRABAJOS_CORREO } from '../../colas/colas.js';
import { ROLES } from '../../common/dominio/roles.js';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_NOTIFICACION,
  TIPOS_TOKEN,
} from '../../common/dominio/valores.js';
import type { Entorno } from '../../config/entorno.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { CuentasService } from './cuentas.service.js';
import type { RegistrarCuentaDto } from './dto/registrar-cuenta.dto.js';
import { hashearTokenCorreo } from './tokens.js';

const crearPrisma = () => {
  const tx = {
    usuario: {
      create: vi.fn().mockResolvedValue({ id: 7 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    tokenCorreo: {
      create: vi.fn().mockResolvedValue({ id: 1 }),
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    notificacion: { create: vi.fn().mockResolvedValue({ id: 99 }) },
  };
  const prisma = {
    usuario: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { prisma, tx };
};

const entorno: Partial<Entorno> = {
  URL_TIENDA: 'http://tienda.test/',
  CONFIRMACION_CORREO_HORAS: 24,
};

const dtoBase = (): RegistrarCuentaDto => ({
  nombre: 'Camila',
  apellido: 'Rojas',
  email: 'camila@correo.cl',
  contrasena: 'Secreta123',
  confirmacionContrasena: 'Secreta123',
  rut: '12345678-5',
});

describe('CuentasService', () => {
  let prisma: ReturnType<typeof crearPrisma>['prisma'];
  let tx: ReturnType<typeof crearPrisma>['tx'];
  let correos: { add: ReturnType<typeof vi.fn> };
  let servicio: CuentasService;

  beforeEach(() => {
    ({ prisma, tx } = crearPrisma());
    correos = { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };
    const config = {
      get: (clave: keyof Entorno) => entorno[clave],
    } as unknown as ConfigService<Entorno, true>;
    servicio = new CuentasService(
      prisma as unknown as PrismaService,
      config,
      correos as unknown as Queue,
    );
  });

  describe('registrar', () => {
    it('E1-H1 · registro exitoso: crea la cuenta sin verificar, guarda el token y encola el correo', async () => {
      const respuesta = await servicio.registrar(dtoBase());

      expect(respuesta.mensaje).toMatch(/cuenta fue creada/);

      const datosUsuario = tx.usuario.create.mock.calls[0][0].data;
      expect(datosUsuario).toMatchObject({
        email: 'camila@correo.cl',
        rut: '12345678-5',
        rol: ROLES.CLIENTE,
      });
      expect(datosUsuario.fechaVerificacionCorreo).toBeUndefined();
      expect(datosUsuario.contrasenaHash).not.toBe('Secreta123');
      expect(
        await argon2.verify(datosUsuario.contrasenaHash, 'Secreta123'),
      ).toBe(true);

      const datosToken = tx.tokenCorreo.create.mock.calls[0][0].data;
      expect(datosToken.tipo).toBe(TIPOS_TOKEN.CONFIRMACION_CORREO);
      expect(datosToken.usuarioId).toBe(7);

      expect(tx.notificacion.create.mock.calls[0][0].data).toMatchObject({
        usuarioId: 7,
        tipo: TIPOS_NOTIFICACION.CONFIRMACION_CORREO,
        estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
      });

      expect(correos.add).toHaveBeenCalledTimes(1);
      const [nombreTrabajo, datos, opciones] = correos.add.mock.calls[0];
      expect(nombreTrabajo).toBe(TRABAJOS_CORREO.CONFIRMACION_CORREO);
      expect(opciones).toMatchObject({
        priority: PRIORIDAD_CORREO.PEDIDO_Y_CUENTA,
        removeOnComplete: true,
        removeOnFail: true,
      });
      expect(datos).toMatchObject({
        notificacionId: 99,
        destinatario: 'camila@correo.cl',
      });

      // El token del enlace es el que corresponde al hash guardado
      const token = new URL(datos.enlace).searchParams.get('token')!;
      expect(
        datos.enlace.startsWith('http://tienda.test/confirmar-correo?'),
      ).toBe(true);
      expect(hashearTokenCorreo(token)).toBe(datosToken.tokenHash);
    });

    it('E1-H1 · registro exitoso: el enlace vence en 24 horas', async () => {
      const antes = Date.now();
      await servicio.registrar(dtoBase());
      const { fechaExpiracion } = tx.tokenCorreo.create.mock.calls[0][0].data;
      const horas = (fechaExpiracion.getTime() - antes) / 3_600_000;
      expect(horas).toBeGreaterThan(23.99);
      expect(horas).toBeLessThanOrEqual(24.01);
    });

    it('E1-H1 · registro exitoso: encola después de confirmar la transacción', async () => {
      const orden: string[] = [];
      prisma.$transaction.mockImplementation(async (fn) => {
        const r = await fn(tx);
        orden.push('commit');
        return r;
      });
      correos.add.mockImplementation(async () => orden.push('encolar'));

      await servicio.registrar(dtoBase());
      expect(orden).toEqual(['commit', 'encolar']);
    });

    it('E1-H1 · registro exitoso: si la cola falla, la cuenta queda creada igual', async () => {
      correos.add.mockRejectedValue(new Error('Redis caído'));
      await expect(servicio.registrar(dtoBase())).resolves.toHaveProperty(
        'mensaje',
      );
      expect(tx.usuario.create).toHaveBeenCalled();
    });

    it('E1-H1 · contraseñas que no coinciden: no crea la cuenta', async () => {
      const dto = Object.assign(dtoBase(), {
        confirmacionContrasena: 'Otra12345',
      });
      await expect(servicio.registrar(dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('E1-H1 · fecha de nacimiento futura: no crea la cuenta', async () => {
      const dto = Object.assign(dtoBase(), { fechaNacimiento: '2999-01-01' });
      await expect(servicio.registrar(dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('E1-H1 · correo o RUT ya registrado: no crea la cuenta (correo)', async () => {
      prisma.usuario.findMany.mockResolvedValue([
        { email: 'camila@correo.cl', rut: null },
      ]);
      await expect(servicio.registrar(dtoBase())).rejects.toThrow(
        new ConflictException('El correo ya está registrado.'),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(correos.add).not.toHaveBeenCalled();
    });

    it('E1-H1 · correo o RUT ya registrado: no crea la cuenta (RUT)', async () => {
      prisma.usuario.findMany.mockResolvedValue([
        { email: 'otra@correo.cl', rut: '12345678-5' },
      ]);
      await expect(servicio.registrar(dtoBase())).rejects.toThrow(
        new ConflictException('El RUT ya está registrado.'),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('E1-H1 · correo o RUT ya registrado: informa ambos datos', async () => {
      prisma.usuario.findMany.mockResolvedValue([
        { email: 'camila@correo.cl', rut: '12345678-5' },
      ]);
      await expect(servicio.registrar(dtoBase())).rejects.toThrow(
        new ConflictException('El correo y el RUT ya están registrados.'),
      );
    });

    it('E1-H1 · correo o RUT ya registrado: un registro simultáneo responde 409', async () => {
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      prisma.usuario.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ email: 'camila@correo.cl', rut: null }]);

      await expect(servicio.registrar(dtoBase())).rejects.toThrow(
        new ConflictException('El correo ya está registrado.'),
      );
      expect(correos.add).not.toHaveBeenCalled();
    });

    it('sin RUT no lo busca entre los existentes', async () => {
      const { rut: _rut, ...sinRut } = dtoBase();
      await servicio.registrar(sinRut);
      expect(prisma.usuario.findMany.mock.calls[0][0].where).toEqual({
        OR: [{ email: 'camila@correo.cl' }],
      });
    });
  });

  describe('confirmarCorreo', () => {
    it('E1-H1 · confirmación del correo: con enlace vigente marca el correo como verificado', async () => {
      tx.tokenCorreo.findUnique.mockResolvedValue({
        id: 1,
        usuarioId: 7,
        tipo: TIPOS_TOKEN.CONFIRMACION_CORREO,
      });

      const respuesta = await servicio.confirmarCorreo('token-del-correo');

      expect(respuesta.mensaje).toMatch(/confirmado/);
      expect(tx.tokenCorreo.findUnique.mock.calls[0][0].where).toEqual({
        tokenHash: hashearTokenCorreo('token-del-correo'),
      });
      const consumo = tx.tokenCorreo.updateMany.mock.calls[0][0];
      expect(consumo.where).toMatchObject({ id: 1, fechaUso: null });
      expect(consumo.where.fechaExpiracion.gt).toBeInstanceOf(Date);
      expect(tx.usuario.updateMany.mock.calls[0][0]).toMatchObject({
        where: { id: 7, fechaVerificacionCorreo: null },
      });
    });

    it('E1-H1 · confirmación del correo: token inexistente responde 400', async () => {
      tx.tokenCorreo.findUnique.mockResolvedValue(null);
      await expect(servicio.confirmarCorreo('x')).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.usuario.updateMany).not.toHaveBeenCalled();
    });

    it('E1-H1 · confirmación del correo: enlace vencido o ya usado responde 400', async () => {
      tx.tokenCorreo.findUnique.mockResolvedValue({
        id: 1,
        usuarioId: 7,
        tipo: TIPOS_TOKEN.CONFIRMACION_CORREO,
      });
      tx.tokenCorreo.updateMany.mockResolvedValue({ count: 0 });
      await expect(servicio.confirmarCorreo('x')).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.usuario.updateMany).not.toHaveBeenCalled();
    });

    it('E1-H1 · confirmación del correo: un token de otro tipo no sirve', async () => {
      tx.tokenCorreo.findUnique.mockResolvedValue({
        id: 1,
        usuarioId: 7,
        tipo: 'otro_tipo',
      });
      await expect(servicio.confirmarCorreo('x')).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.tokenCorreo.updateMany).not.toHaveBeenCalled();
    });
  });
});
