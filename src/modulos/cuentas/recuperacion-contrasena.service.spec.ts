import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import argon2 from 'argon2';
import type { Queue } from 'bullmq';
import { PRIORIDAD_CORREO, TRABAJOS_CORREO } from '../../colas/colas.js';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_NOTIFICACION,
  TIPOS_TOKEN,
} from '../../common/dominio/valores.js';
import type { Entorno } from '../../config/entorno.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { RestablecerContrasenaDto } from './dto/restablecer-contrasena.dto.js';
import { RecuperacionContrasenaService } from './recuperacion-contrasena.service.js';
import type { SolicitudesRecuperacion } from './solicitudes-recuperacion.js';
import { hashearTokenCorreo } from './tokens.js';

const crearPrisma = () => {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 7 }]),
    usuario: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    tokenCorreo: {
      create: vi.fn().mockResolvedValue({ id: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    notificacion: { create: vi.fn().mockResolvedValue({ id: 99 }) },
    sesion: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
  };
  const prisma = {
    usuario: {
      findUnique: vi.fn().mockResolvedValue({
        codigoPublico: 'uuid-camila',
        nombre: 'Camila',
        activo: true,
      }),
    },
    tokenCorreo: {
      findUnique: vi.fn().mockResolvedValue({
        id: 5,
        usuarioId: 7,
        tipo: TIPOS_TOKEN.RECUPERACION_CONTRASENA,
      }),
    },
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { prisma, tx };
};

const entorno: Partial<Entorno> = {
  URL_TIENDA: 'http://tienda.test/',
  RECUPERACION_CONTRASENA_HORAS: 1,
};

const dtoCambio = (
  cambios: Partial<RestablecerContrasenaDto> = {},
): RestablecerContrasenaDto => ({
  token: 'token-del-enlace',
  contrasena: 'Nueva1234',
  confirmacionContrasena: 'Nueva1234',
  ...cambios,
});

describe('RecuperacionContrasenaService', () => {
  let prisma: ReturnType<typeof crearPrisma>['prisma'];
  let tx: ReturnType<typeof crearPrisma>['tx'];
  let correos: { add: ReturnType<typeof vi.fn> };
  let solicitudes: { reservar: ReturnType<typeof vi.fn> };
  let servicio: RecuperacionContrasenaService;

  beforeEach(() => {
    ({ prisma, tx } = crearPrisma());
    correos = { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };
    solicitudes = { reservar: vi.fn().mockResolvedValue(true) };
    const config = {
      get: (clave: keyof Entorno) => entorno[clave],
    } as unknown as ConfigService<Entorno, true>;
    servicio = new RecuperacionContrasenaService(
      prisma as unknown as PrismaService,
      config,
      correos as unknown as Queue,
      solicitudes as unknown as SolicitudesRecuperacion,
    );
  });

  describe('solicitar', () => {
    it('E1-H4 · solicitud de recuperación: genera un token de un uso que vence en 1 h y encola el correo con el enlace', async () => {
      const antes = Date.now();
      const respuesta = await servicio.solicitar('camila@correo.cl');

      expect(respuesta.mensaje).toMatch(/Si el correo tiene una cuenta/);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);

      const datosToken = tx.tokenCorreo.create.mock.calls[0][0].data;
      expect(datosToken).toMatchObject({
        usuarioId: 7,
        tipo: TIPOS_TOKEN.RECUPERACION_CONTRASENA,
      });
      const vence = (datosToken.fechaExpiracion as Date).getTime();
      expect(vence - antes).toBeGreaterThanOrEqual(60 * 60 * 1000);
      expect(vence - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000);

      expect(tx.notificacion.create.mock.calls[0][0].data).toMatchObject({
        usuarioId: 7,
        tipo: TIPOS_NOTIFICACION.RECUPERACION_CONTRASENA,
        estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
      });

      expect(correos.add).toHaveBeenCalledTimes(1);
      const [nombreTrabajo, datos, opciones] = correos.add.mock.calls[0];
      expect(nombreTrabajo).toBe(TRABAJOS_CORREO.RECUPERACION_CONTRASENA);
      expect(opciones).toMatchObject({
        priority: PRIORIDAD_CORREO.PEDIDO_Y_CUENTA,
        removeOnComplete: true,
        removeOnFail: true,
      });
      expect(datos).toMatchObject({
        notificacionId: 99,
        destinatario: 'camila@correo.cl',
        nombre: 'Camila',
      });

      // Solo se guarda el hash; el token en claro va en el enlace
      const token = new URL(datos.enlace).searchParams.get('token')!;
      expect(
        datos.enlace.startsWith('http://tienda.test/restablecer-contrasena?'),
      ).toBe(true);
      expect(datosToken.tokenHash).not.toBe(token);
      expect(hashearTokenCorreo(token)).toBe(datosToken.tokenHash);
    });

    it('E1-H4 · solicitud de recuperación: el enlace nuevo deja sin efecto los de recuperación aún vigentes', async () => {
      await servicio.solicitar('camila@correo.cl');

      const invalidacion = tx.tokenCorreo.updateMany.mock.calls[0][0];
      expect(invalidacion.where).toMatchObject({
        usuarioId: 7,
        tipo: { in: [TIPOS_TOKEN.RECUPERACION_CONTRASENA] },
        fechaUso: null,
      });
      expect(invalidacion.data.fechaExpiracion).toBeInstanceOf(Date);
      // Se invalida antes de crear el nuevo
      expect(
        tx.tokenCorreo.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(tx.tokenCorreo.create.mock.invocationCallOrder[0]);
    });

    it('E1-H4 · correo sin cuenta: responde lo mismo y no crea token ni correo', async () => {
      const conCuenta = await servicio.solicitar('camila@correo.cl');
      prisma.usuario.findUnique.mockResolvedValue(null);

      const sinCuenta = await servicio.solicitar('nadie@correo.cl');

      expect(sinCuenta).toEqual(conCuenta);
      // Solo la solicitud con cuenta abrió la transacción y encoló el correo
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(correos.add).toHaveBeenCalledTimes(1);
    });

    it('E1-H4 · cuenta desactivada: responde lo mismo y no envía el enlace', async () => {
      prisma.usuario.findUnique.mockResolvedValue({
        codigoPublico: 'uuid-camila',
        nombre: 'Camila',
        activo: false,
      });

      const respuesta = await servicio.solicitar('camila@correo.cl');

      expect(respuesta.mensaje).toMatch(/Si el correo tiene una cuenta/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(correos.add).not.toHaveBeenCalled();
    });

    it('E1-H4 · límite por correo: pasado el tope responde lo mismo y no envía el enlace', async () => {
      const dentroDelTope = await servicio.solicitar('camila@correo.cl');
      solicitudes.reservar.mockResolvedValue(false);

      const pasadoElTope = await servicio.solicitar('camila@correo.cl');

      expect(pasadoElTope).toEqual(dentroDelTope);
      expect(solicitudes.reservar).toHaveBeenLastCalledWith('camila@correo.cl');
      // Solo la primera llegó a la base y a la cola
      expect(prisma.usuario.findUnique).toHaveBeenCalledTimes(1);
      expect(correos.add).toHaveBeenCalledTimes(1);
    });

    it('E1-H4 · límite por correo: cuenta también los correos sin cuenta', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);

      await servicio.solicitar('nadie@correo.cl');

      expect(solicitudes.reservar).toHaveBeenCalledWith('nadie@correo.cl');
    });

    it('E1-H4 · si Redis no responde, la solicitud no falla (RNF-32)', async () => {
      correos.add.mockRejectedValue(new Error('Redis caído'));

      await expect(servicio.solicitar('camila@correo.cl')).resolves.toEqual({
        mensaje: expect.stringMatching(/Si el correo tiene una cuenta/),
      });
      expect(tx.notificacion.create).toHaveBeenCalled();
    });
  });

  describe('restablecer', () => {
    it('E1-H4 · cambio de contraseña: guarda la nueva y deja el token sin efecto', async () => {
      const respuesta = await servicio.restablecer(dtoCambio());

      expect(respuesta.mensaje).toMatch(/contraseña quedó actualizada/);
      expect(prisma.tokenCorreo.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: hashearTokenCorreo('token-del-enlace') },
        }),
      );

      const consumo = tx.tokenCorreo.updateMany.mock.calls[0][0];
      expect(consumo.where).toMatchObject({ id: 5, fechaUso: null });
      expect(consumo.where.fechaExpiracion.gt).toBeInstanceOf(Date);
      expect(consumo.data.fechaUso).toBeInstanceOf(Date);

      const cambio = tx.usuario.updateMany.mock.calls[0][0];
      expect(cambio.where).toEqual({ id: 7, activo: true });
      expect(cambio.data.contrasenaHash).not.toBe('Nueva1234');
      expect(await argon2.verify(cambio.data.contrasenaHash, 'Nueva1234')).toBe(
        true,
      );
    });

    it('E1-H4 · cambio de contraseña: cierra todas las sesiones de la cuenta (RNF-28)', async () => {
      await servicio.restablecer(dtoCambio());

      expect(tx.sesion.updateMany).toHaveBeenCalledWith({
        where: { usuarioId: 7, fechaRevocacion: null },
        data: { fechaRevocacion: expect.any(Date) },
      });
    });

    it('E1-H4 · cambio de contraseña: confirma el correo si no lo estaba e invalida los demás enlaces de contraseña', async () => {
      await servicio.restablecer(dtoCambio());

      expect(tx.usuario.updateMany.mock.calls[1][0]).toEqual({
        where: { id: 7, fechaVerificacionCorreo: null },
        data: { fechaVerificacionCorreo: expect.any(Date) },
      });
      expect(tx.tokenCorreo.updateMany.mock.calls[1][0].where).toMatchObject({
        usuarioId: 7,
        tipo: {
          in: [
            TIPOS_TOKEN.RECUPERACION_CONTRASENA,
            TIPOS_TOKEN.INVITACION_PERSONAL,
          ],
        },
        fechaUso: null,
      });
    });

    it('E1-H4 · token vencido o ya usado: rechaza el cambio y pide un enlace nuevo', async () => {
      tx.tokenCorreo.updateMany.mockResolvedValueOnce({ count: 0 });

      const error = await servicio.restablecer(dtoCambio()).catch((e) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toMatch(
        /Solicita uno nuevo/,
      );
      expect(tx.usuario.updateMany).not.toHaveBeenCalled();
      expect(tx.sesion.updateMany).not.toHaveBeenCalled();
    });

    it('E1-H4 · token inexistente: rechaza el cambio sin calcular el hash', async () => {
      prisma.tokenCorreo.findUnique.mockResolvedValue(null);
      const hash = vi.spyOn(argon2, 'hash');

      await expect(servicio.restablecer(dtoCambio())).rejects.toThrow(
        /Solicita uno nuevo/,
      );
      expect(hash).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      hash.mockRestore();
    });

    it('E1-H4 · token de otro tipo (confirmación o invitación): rechaza el cambio', async () => {
      prisma.tokenCorreo.findUnique.mockResolvedValue({
        id: 5,
        usuarioId: 7,
        tipo: TIPOS_TOKEN.CONFIRMACION_CORREO,
      });

      await expect(servicio.restablecer(dtoCambio())).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('E1-H4 · cuenta desactivada después de pedir el enlace: rechaza el cambio', async () => {
      tx.usuario.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(servicio.restablecer(dtoCambio())).rejects.toThrow(
        /Solicita uno nuevo/,
      );
      expect(tx.sesion.updateMany).not.toHaveBeenCalled();
    });

    it('E1-H4 · contraseñas distintas: rechaza sin consultar el token', async () => {
      await expect(
        servicio.restablecer(
          dtoCambio({ confirmacionContrasena: 'Otra12345' }),
        ),
      ).rejects.toThrow('Las contraseñas no coinciden.');
      expect(prisma.tokenCorreo.findUnique).not.toHaveBeenCalled();
    });
  });
});
