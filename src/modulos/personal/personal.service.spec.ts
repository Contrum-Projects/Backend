import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import argon2 from 'argon2';
import type { Queue } from 'bullmq';
import { PRIORIDAD_CORREO, TRABAJOS_CORREO } from '../../colas/colas.js';
import { ROLES, type Rol } from '../../common/dominio/roles.js';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_NOTIFICACION,
  TIPOS_TOKEN,
} from '../../common/dominio/valores.js';
import type { Entorno } from '../../config/entorno.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { hashearTokenCorreo } from '../cuentas/tokens.js';
import { PersonalService } from './personal.service.js';

const ADMIN = {
  codigoPublico: 'a1a1a1a1-0000-4000-8000-000000000001',
  rol: ROLES.ADMINISTRADOR,
  sesion: 's1',
};
const CODIGO = 'b2b2b2b2-0000-4000-8000-000000000002';

const cuenta = (cambios: Record<string, unknown> = {}) => ({
  id: 20,
  codigoPublico: CODIGO,
  nombre: 'Javiera',
  apellido: 'Muñoz',
  email: 'javiera@cabelloperfecto.cl',
  rol: ROLES.VENDEDOR as Rol,
  activo: true,
  fechaVerificacionCorreo: null as Date | null,
  ...cambios,
});

const crearPrisma = () => {
  const tx = {
    usuario: {
      create: vi.fn().mockResolvedValue(cuenta()),
      findFirst: vi.fn().mockResolvedValue(cuenta()),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    sesion: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    tokenCorreo: {
      create: vi.fn().mockResolvedValue({ id: 1 }),
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    notificacion: { create: vi.fn().mockResolvedValue({ id: 99 }) },
    // Administradores activos bloqueados: el que desactiva y otro más
    $queryRaw: vi.fn().mockResolvedValue([
      { id: 1, codigoPublico: ADMIN.codigoPublico },
      { id: 2, codigoPublico: 'c3c3c3c3-0000-4000-8000-000000000003' },
    ]),
  };
  const prisma = {
    usuario: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    tokenCorreo: { findUnique: vi.fn() },
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { prisma, tx };
};

const entorno: Partial<Entorno> = {
  URL_TIENDA: 'http://tienda.test/',
  INVITACION_PERSONAL_HORAS: 72,
};

describe('PersonalService', () => {
  let prisma: ReturnType<typeof crearPrisma>['prisma'];
  let tx: ReturnType<typeof crearPrisma>['tx'];
  let correos: { add: ReturnType<typeof vi.fn> };
  let servicio: PersonalService;

  beforeEach(() => {
    ({ prisma, tx } = crearPrisma());
    correos = { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };
    const config = {
      get: (clave: keyof Entorno) => entorno[clave],
    } as unknown as ConfigService<Entorno, true>;
    servicio = new PersonalService(
      prisma as unknown as PrismaService,
      config,
      correos as unknown as Queue,
    );
  });

  describe('crear', () => {
    const dto = () => ({
      nombre: 'Javiera',
      apellido: 'Muñoz',
      email: 'javiera@cabelloperfecto.cl',
      rol: ROLES.VENDEDOR as Rol,
    });

    it('E13-H1 · cuenta creada: con ese único rol, sin contraseña conocida y con la invitación encolada', async () => {
      const antes = Date.now();
      const creada = await servicio.crear(dto(), ADMIN);

      expect(creada).toEqual({
        codigoPublico: CODIGO,
        nombre: 'Javiera',
        apellido: 'Muñoz',
        email: 'javiera@cabelloperfecto.cl',
        rol: ROLES.VENDEDOR,
        activo: true,
        invitacionPendiente: true,
      });
      const datos = tx.usuario.create.mock.calls[0][0].data;
      expect(datos).toMatchObject({ rol: ROLES.VENDEDOR });
      expect(datos).not.toHaveProperty('fechaVerificacionCorreo');
      // La contraseña es aleatoria: ninguna contraseña elegida la verifica
      expect(await argon2.verify(datos.contrasenaHash, 'Secreta123')).toBe(
        false,
      );

      const token = tx.tokenCorreo.create.mock.calls[0][0].data;
      expect(token.tipo).toBe(TIPOS_TOKEN.INVITACION_PERSONAL);
      const horas = (token.fechaExpiracion.getTime() - antes) / 3_600_000;
      expect(horas).toBeCloseTo(72, 1);
      expect(tx.notificacion.create.mock.calls[0][0].data).toMatchObject({
        tipo: TIPOS_NOTIFICACION.INVITACION_PERSONAL,
        estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
      });

      const [trabajo, datosTrabajo, opciones] = correos.add.mock.calls[0];
      expect(trabajo).toBe(TRABAJOS_CORREO.INVITACION_PERSONAL);
      expect(opciones.priority).toBe(PRIORIDAD_CORREO.PEDIDO_Y_CUENTA);
      const enlace = new URL(datosTrabajo.enlace);
      expect(enlace.origin + enlace.pathname).toBe(
        'http://tienda.test/personal/activar',
      );
      // El enlace lleva el token cuyo hash quedó guardado
      expect(hashearTokenCorreo(enlace.searchParams.get('token')!)).toBe(
        token.tokenHash,
      );
    });

    it('E13-H1 · cuenta creada: el correo que pertenece a otra cuenta responde 409 sin crearla', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ id: 3 });

      await expect(servicio.crear(dto(), ADMIN)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(correos.add).not.toHaveBeenCalled();
    });

    it('E13-H1 · cuenta creada: dos creaciones simultáneas con el mismo correo → la segunda responde 409', async () => {
      tx.usuario.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('único', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(servicio.crear(dto(), ADMIN)).rejects.toThrow(
        ConflictException,
      );
      expect(correos.add).not.toHaveBeenCalled();
    });
  });

  describe('desactivar', () => {
    it('E13-H1 · cuenta desactivada: la desactiva, cierra todas sus sesiones e invalida su invitación', async () => {
      await servicio.desactivar(CODIGO, ADMIN);

      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.usuario.update).toHaveBeenCalledWith({
        where: { id: 20 },
        data: { activo: false },
      });
      expect(tx.sesion.updateMany.mock.calls[0][0].where).toEqual({
        usuarioId: 20,
        fechaRevocacion: null,
      });
      expect(tx.tokenCorreo.updateMany.mock.calls[0][0].where).toMatchObject({
        usuarioId: 20,
        tipo: TIPOS_TOKEN.INVITACION_PERSONAL,
        fechaUso: null,
      });
    });

    it('E13-H1 · cuenta desactivada: el administrador no puede desactivar su propia cuenta (409)', async () => {
      await expect(
        servicio.desactivar(ADMIN.codigoPublico, ADMIN),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('E13-H1 · cuenta desactivada: un administrador desactivado mientras esperaba el bloqueo no desactiva a nadie (403)', async () => {
      // Ya no está entre los administradores activos bloqueados
      tx.$queryRaw.mockResolvedValue([
        { id: 2, codigoPublico: 'c3c3c3c3-0000-4000-8000-000000000003' },
      ]);

      await expect(servicio.desactivar(CODIGO, ADMIN)).rejects.toThrow(
        ForbiddenException,
      );
      expect(tx.usuario.update).not.toHaveBeenCalled();
    });

    it('E13-H1 · cuenta desactivada: un administrador desactiva a otro administrador; queda él activo', async () => {
      tx.usuario.findFirst.mockResolvedValue(
        cuenta({ id: 2, rol: ROLES.ADMINISTRADOR }),
      );

      await servicio.desactivar(CODIGO, ADMIN);
      expect(tx.usuario.update).toHaveBeenCalled();
    });

    it('E13-H1 · cuenta desactivada: una cuenta ya desactivada no cambia y una que no es del personal da 404', async () => {
      tx.usuario.findFirst.mockResolvedValueOnce(cuenta({ activo: false }));
      await servicio.desactivar(CODIGO, ADMIN);
      expect(tx.usuario.update).not.toHaveBeenCalled();

      tx.usuario.findFirst.mockResolvedValueOnce(null);
      await expect(servicio.desactivar(CODIGO, ADMIN)).rejects.toThrow(
        NotFoundException,
      );
      // Solo busca entre los roles del personal
      expect(tx.usuario.findFirst.mock.calls[1][0].where.rol).toEqual({
        in: [ROLES.VENDEDOR, ROLES.BODEGUERO, ROLES.ADMINISTRADOR],
      });
    });
  });

  describe('aceptarInvitacion', () => {
    const dto = (cambios: Record<string, string> = {}) => ({
      token: 'token-del-enlace',
      contrasena: 'Secreta123',
      confirmacionContrasena: 'Secreta123',
      ...cambios,
    });

    beforeEach(() => {
      prisma.tokenCorreo.findUnique.mockResolvedValue({
        id: 5,
        usuarioId: 20,
        tipo: TIPOS_TOKEN.INVITACION_PERSONAL,
      });
    });

    it('E13-H1 · cuenta creada: con el enlace vigente define la contraseña y confirma el correo', async () => {
      await servicio.aceptarInvitacion(dto());

      expect(prisma.tokenCorreo.findUnique.mock.calls[0][0].where).toEqual({
        tokenHash: hashearTokenCorreo('token-del-enlace'),
      });
      const consumo = tx.tokenCorreo.updateMany.mock.calls[0][0];
      expect(consumo.where).toMatchObject({ id: 5, fechaUso: null });
      const { where, data } = tx.usuario.updateMany.mock.calls[0][0];
      expect(where).toEqual({
        id: 20,
        activo: true,
        fechaVerificacionCorreo: null,
      });
      expect(data.fechaVerificacionCorreo).toBeInstanceOf(Date);
      expect(await argon2.verify(data.contrasenaHash, 'Secreta123')).toBe(true);
    });

    it('E13-H1 · ingreso con cuenta desactivada: una cuenta desactivada no puede aceptar su invitación', async () => {
      tx.usuario.updateMany.mockResolvedValue({ count: 0 });

      await expect(servicio.aceptarInvitacion(dto())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('E13-H1 · cuenta creada: un enlace usado, vencido, de otro tipo o desconocido no sirve', async () => {
      tx.tokenCorreo.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(servicio.aceptarInvitacion(dto())).rejects.toThrow(
        BadRequestException,
      );

      prisma.tokenCorreo.findUnique.mockResolvedValueOnce({
        id: 6,
        usuarioId: 20,
        tipo: TIPOS_TOKEN.CONFIRMACION_CORREO,
      });
      await expect(servicio.aceptarInvitacion(dto())).rejects.toThrow(
        BadRequestException,
      );

      prisma.tokenCorreo.findUnique.mockResolvedValueOnce(null);
      await expect(servicio.aceptarInvitacion(dto())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('RNF-09 · un token desconocido responde 400 antes de calcular la contraseña', async () => {
      prisma.tokenCorreo.findUnique.mockResolvedValue(null);
      const hash = vi.spyOn(argon2, 'hash');

      await expect(servicio.aceptarInvitacion(dto())).rejects.toThrow(
        BadRequestException,
      );
      expect(hash).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      hash.mockRestore();
    });

    it('E13-H1 · cuenta creada: contraseñas distintas responden 400 sin tocar la base', async () => {
      await expect(
        servicio.aceptarInvitacion(dto({ confirmacionContrasena: 'Otra1234' })),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('reenviarInvitacion', () => {
    it('E13-H1 · reenviar invitación: invalida el enlace anterior y encola uno nuevo', async () => {
      await servicio.reenviarInvitacion(CODIGO, ADMIN);

      expect(tx.tokenCorreo.updateMany.mock.calls[0][0].where).toMatchObject({
        usuarioId: 20,
        tipo: TIPOS_TOKEN.INVITACION_PERSONAL,
        fechaUso: null,
      });
      expect(tx.tokenCorreo.create).toHaveBeenCalled();
      expect(correos.add.mock.calls[0][0]).toBe(
        TRABAJOS_CORREO.INVITACION_PERSONAL,
      );
    });

    it('E13-H1 · reenviar invitación: no se reenvía a una cuenta desactivada o que ya definió su contraseña (409)', async () => {
      tx.usuario.findFirst.mockResolvedValueOnce(cuenta({ activo: false }));
      await expect(servicio.reenviarInvitacion(CODIGO, ADMIN)).rejects.toThrow(
        ConflictException,
      );

      tx.usuario.findFirst.mockResolvedValueOnce(
        cuenta({ fechaVerificacionCorreo: new Date() }),
      );
      await expect(servicio.reenviarInvitacion(CODIGO, ADMIN)).rejects.toThrow(
        ConflictException,
      );
      expect(correos.add).not.toHaveBeenCalled();
    });

    it('E13-H1 · reenviar invitación: bloquea la cuenta antes de revisarla', async () => {
      await servicio.reenviarInvitacion(CODIGO, ADMIN);

      // Primero el administrador (FOR SHARE), luego la cuenta (FOR UPDATE)
      expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
      expect(tx.$queryRaw.mock.calls[1][0].join('')).toMatch(/FOR UPDATE/);
    });
  });

  describe('administrador que hace la petición', () => {
    it('E13-H1 · cuenta desactivada: un administrador desactivado no crea cuentas ni reenvía invitaciones (403)', async () => {
      tx.$queryRaw.mockResolvedValue([]);

      await expect(
        servicio.crear(
          {
            nombre: 'Javiera',
            apellido: 'Muñoz',
            email: 'nueva@cabelloperfecto.cl',
            rol: ROLES.VENDEDOR,
          },
          ADMIN,
        ),
      ).rejects.toThrow(ForbiddenException);
      await expect(servicio.reenviarInvitacion(CODIGO, ADMIN)).rejects.toThrow(
        ForbiddenException,
      );
      expect(tx.usuario.create).not.toHaveBeenCalled();
      expect(correos.add).not.toHaveBeenCalled();
    });
  });
});
