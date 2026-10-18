import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import {
  AUDIENCIA_TOKEN_ACCESO,
  type CargaTokenAcceso,
} from '../../autenticacion/carga-token.js';
import { ROLES } from '../../common/dominio/roles.js';
import type { Entorno } from '../../config/entorno.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { IntentosSesion } from './intentos-sesion.js';
import {
  DemasiadosIntentosException,
  SesionService,
} from './sesion.service.js';
import { hashearTokenSesion } from './tokens.js';

const SECRETO = 'secreto-de-prueba-con-al-menos-32-caracteres';
const entorno: Partial<Entorno> = {
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '30d',
};
const SID = '5d2f9a1c-7b3e-4f60-8a91-c4e2d7f3b8a0';
const contexto = { ip: '1.2.3.4', dispositivo: 'Mozilla/5.0' };
const credenciales = () => ({
  email: 'camila@correo.cl',
  contrasena: 'Secreta123',
});

describe('SesionService', () => {
  let hashContrasena: string;
  let prisma: {
    usuario: { findUnique: ReturnType<typeof vi.fn> };
    sesion: {
      create: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };
  let intentos: {
    reservar: ReturnType<typeof vi.fn>;
    descontar: ReturnType<typeof vi.fn>;
    confirmarExito: ReturnType<typeof vi.fn>;
  };
  let jwt: JwtService;
  let servicio: SesionService;

  const usuario = (cambios: Record<string, unknown> = {}) => ({
    id: 7,
    codigoPublico: '0b5c7f6e-3a0e-4c55-9d43-2f0f8e2b1a11',
    nombre: 'Camila',
    apellido: 'Rojas',
    rol: ROLES.PROFESIONAL,
    contrasenaHash: hashContrasena,
    activo: true,
    fechaVerificacionCorreo: new Date('2026-10-15T12:00:00Z'),
    ...cambios,
  });

  beforeAll(async () => {
    hashContrasena = await argon2.hash('Secreta123');
  });

  beforeEach(async () => {
    prisma = {
      usuario: { findUnique: vi.fn().mockResolvedValue(usuario()) },
      sesion: {
        create: vi.fn().mockResolvedValue({ codigoPublico: SID }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    intentos = {
      reservar: vi.fn().mockResolvedValue(0),
      descontar: vi.fn().mockResolvedValue(undefined),
      confirmarExito: vi.fn().mockResolvedValue(undefined),
    };
    jwt = new JwtService({ secret: SECRETO });
    const config = {
      get: (clave: keyof Entorno) => entorno[clave],
    } as unknown as ConfigService<Entorno, true>;
    servicio = new SesionService(
      prisma as unknown as PrismaService,
      config,
      jwt,
      intentos as unknown as IntentosSesion,
    );
    await servicio.onModuleInit();
  });

  describe('inicio de sesión correcto', () => {
    it('E1-H2 · inicio de sesión correcto: entrega el token de acceso con el rol y los datos para el menú', async () => {
      const { sesion } = await servicio.iniciar(credenciales(), contexto);

      expect(sesion.expiraEn).toBe(900);
      expect(sesion.usuario).toEqual({
        codigoPublico: '0b5c7f6e-3a0e-4c55-9d43-2f0f8e2b1a11',
        nombre: 'Camila',
        apellido: 'Rojas',
        rol: ROLES.PROFESIONAL,
      });
      const carga = await jwt.verifyAsync<
        CargaTokenAcceso & { exp: number; iat: number }
      >(sesion.tokenAcceso, { audience: AUDIENCIA_TOKEN_ACCESO });
      expect(carga).toMatchObject({
        sub: '0b5c7f6e-3a0e-4c55-9d43-2f0f8e2b1a11',
        sid: SID,
        rol: ROLES.PROFESIONAL,
        aud: AUDIENCIA_TOKEN_ACCESO,
      });
      expect(carga.exp - carga.iat).toBe(900);
      // Nunca el id correlativo ni datos sensibles en el token (RNF-07)
      expect(carga).not.toHaveProperty('id');
      expect(JSON.stringify(sesion)).not.toContain('contrasenaHash');
    });

    it('E1-H2 · inicio de sesión correcto: guarda la sesión solo con el hash del token de refresco', async () => {
      const antes = Date.now();
      const { tokenRefresco, vencimientoRefresco } = await servicio.iniciar(
        credenciales(),
        contexto,
      );

      const datos = prisma.sesion.create.mock.calls[0][0].data;
      expect(datos).toMatchObject({ usuarioId: 7, dispositivo: 'Mozilla/5.0' });
      expect(datos.tokenRefrescoHash).toBe(hashearTokenSesion(tokenRefresco));
      expect(datos.tokenRefrescoHash).not.toBe(tokenRefresco);
      expect(datos.fechaExpiracion).toEqual(vencimientoRefresco);
      const dias = (vencimientoRefresco.getTime() - antes) / 86_400_000;
      expect(dias).toBeGreaterThan(29.99);
      expect(dias).toBeLessThanOrEqual(30.01);
    });

    it('E1-H2 · inicio de sesión correcto: reinicia el contador de intentos fallidos', async () => {
      await servicio.iniciar(credenciales(), contexto);
      expect(intentos.confirmarExito).toHaveBeenCalledWith(
        'camila@correo.cl',
        '1.2.3.4',
      );
      expect(intentos.descontar).not.toHaveBeenCalled();
    });

    it('E1-H2 · inicio de sesión correcto: recorta el dispositivo a 255 caracteres', async () => {
      await servicio.iniciar(credenciales(), {
        ip: '1.2.3.4',
        dispositivo: 'x'.repeat(400),
      });
      expect(
        prisma.sesion.create.mock.calls[0][0].data.dispositivo,
      ).toHaveLength(255);
    });

    it('E1-H2 · inicio de sesión correcto: la cuenta debe estar activa (desactivada → 403)', async () => {
      prisma.usuario.findUnique.mockResolvedValue(usuario({ activo: false }));
      await expect(servicio.iniciar(credenciales(), contexto)).rejects.toThrow(
        new ForbiddenException('Tu cuenta está desactivada.'),
      );
      expect(prisma.sesion.create).not.toHaveBeenCalled();
      // La contraseña era correcta: el intento reservado no cuenta como fallido
      expect(intentos.descontar).toHaveBeenCalledWith(
        'camila@correo.cl',
        '1.2.3.4',
      );
    });

    it('E1-H2 · inicio de sesión correcto: la cuenta debe estar activa (correo sin confirmar → 403)', async () => {
      prisma.usuario.findUnique.mockResolvedValue(
        usuario({ fechaVerificacionCorreo: null }),
      );
      await expect(servicio.iniciar(credenciales(), contexto)).rejects.toThrow(
        new ForbiddenException(
          'Debes confirmar tu correo antes de iniciar sesión.',
        ),
      );
      expect(prisma.sesion.create).not.toHaveBeenCalled();
      expect(intentos.descontar).toHaveBeenCalledTimes(1);
    });

    it('E1-H2 · la cuenta desactivada no se delata si la contraseña es incorrecta', async () => {
      prisma.usuario.findUnique.mockResolvedValue(
        usuario({ activo: false, fechaVerificacionCorreo: null }),
      );
      await expect(
        servicio.iniciar(
          { ...credenciales(), contrasena: 'Otra12345' },
          contexto,
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(intentos.descontar).not.toHaveBeenCalled();
    });
  });

  describe('credenciales incorrectas', () => {
    it('E1-H2 · credenciales incorrectas: contraseña que no coincide → 401 sin iniciar sesión', async () => {
      await expect(
        servicio.iniciar(
          { ...credenciales(), contrasena: 'Otra12345' },
          contexto,
        ),
      ).rejects.toThrow(
        new UnauthorizedException('Correo o contraseña incorrectos.'),
      );
      expect(prisma.sesion.create).not.toHaveBeenCalled();
      // Reservado antes de verificar, el intento queda contado como fallido
      expect(intentos.reservar).toHaveBeenCalledWith(
        'camila@correo.cl',
        '1.2.3.4',
      );
      expect(intentos.descontar).not.toHaveBeenCalled();
      expect(intentos.confirmarExito).not.toHaveBeenCalled();
    });

    it('E1-H2 · credenciales incorrectas: correo no registrado → el mismo 401', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);
      await expect(servicio.iniciar(credenciales(), contexto)).rejects.toThrow(
        new UnauthorizedException('Correo o contraseña incorrectos.'),
      );
      expect(prisma.sesion.create).not.toHaveBeenCalled();
      expect(intentos.reservar).toHaveBeenCalledTimes(1);
      expect(intentos.descontar).not.toHaveBeenCalled();
    });

    it('E1-H2 · credenciales incorrectas: con correo no registrado igual verifica un hash (tiempo parejo)', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);
      const verificar = vi.spyOn(argon2, 'verify');
      await expect(
        servicio.iniciar(credenciales(), contexto),
      ).rejects.toThrow();
      expect(verificar).toHaveBeenCalledTimes(1);
      expect(verificar.mock.calls[0][0]).toMatch(/^\$argon2/);
      verificar.mockRestore();
    });
  });

  describe('límite de intentos', () => {
    it('E1-H2 · límite de intentos: bloqueado responde 429 con la espera, sin revisar la contraseña', async () => {
      intentos.reservar.mockResolvedValue(600);
      const error = await servicio
        .iniciar(credenciales(), contexto)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DemasiadosIntentosException);
      const excepcion = error as DemasiadosIntentosException;
      expect(excepcion.getStatus()).toBe(429);
      expect(excepcion.esperaSegundos).toBe(600);
      expect(excepcion.message).toBe(
        'Demasiados intentos fallidos. Espera 10 minutos e inténtalo de nuevo.',
      );
      expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
      expect(prisma.sesion.create).not.toHaveBeenCalled();
    });

    it('E1-H2 · límite de intentos: con menos de un minuto de espera habla en singular', () => {
      expect(new DemasiadosIntentosException(20).message).toMatch(
        /Espera 1 minuto e/,
      );
    });
  });

  describe('cierre en el dispositivo en uso', () => {
    it('E1-H3 · cierre en el dispositivo en uso: revoca solo la sesión del token de refresco', async () => {
      await servicio.cerrar(['token-de-refresco']);

      const consulta = prisma.sesion.updateMany.mock.calls[0][0];
      expect(consulta.where).toEqual({
        tokenRefrescoHash: { in: [hashearTokenSesion('token-de-refresco')] },
        fechaRevocacion: null,
      });
      expect(consulta.data.fechaRevocacion).toBeInstanceOf(Date);
    });

    it('E1-H3 · cierre en el dispositivo en uso: con varias cookies de refresco revoca todas', async () => {
      await servicio.cerrar(['plantada', 'real']);

      expect(
        prisma.sesion.updateMany.mock.calls[0][0].where.tokenRefrescoHash,
      ).toEqual({
        in: [hashearTokenSesion('plantada'), hashearTokenSesion('real')],
      });
    });

    it('E1-H3 · cierre en el dispositivo en uso: sin token de refresco no toca la base', async () => {
      await servicio.cerrar([]);

      expect(prisma.sesion.updateMany).not.toHaveBeenCalled();
    });

    it('E1-H3 · cierre en el dispositivo en uso: una sesión ya cerrada o desconocida no falla', async () => {
      prisma.sesion.updateMany.mockResolvedValue({ count: 0 });

      await expect(servicio.cerrar(['token-viejo'])).resolves.toBeUndefined();
    });
  });

  describe('cierre en todos los dispositivos', () => {
    it('E1-H3 · cierre en todos los dispositivos: revoca todas las sesiones abiertas de la cuenta', async () => {
      await servicio.cerrarTodas('0b5c7f6e-3a0e-4c55-9d43-2f0f8e2b1a11');

      const consulta = prisma.sesion.updateMany.mock.calls[0][0];
      expect(consulta.where).toEqual({
        usuario: { codigoPublico: '0b5c7f6e-3a0e-4c55-9d43-2f0f8e2b1a11' },
        fechaRevocacion: null,
      });
      expect(consulta.data.fechaRevocacion).toBeInstanceOf(Date);
    });
  });
});
