import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ROLES } from '../../common/dominio/roles.js';
import {
  ESPECIALIDADES,
  MODALIDADES_TRABAJO,
} from '../../common/dominio/valores.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { GuardarPerfilProfesionalDto } from './dto/guardar-perfil-profesional.dto.js';
import {
  PerfilProfesionalService,
  SIN_PERFIL,
} from './perfil-profesional.service.js';

const CODIGO = '3f0c2a52-0b9e-4c55-9d0e-6a3a4f6d1b2c';

const crearPrisma = () => {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 7 }]),
    usuario: { findFirst: vi.fn().mockResolvedValue({ id: 7 }) },
    perfilProfesional: { upsert: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    perfilProfesional: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { prisma, tx };
};

const dtoBase = (
  opcionales: Pick<
    GuardarPerfilProfesionalDto,
    'nombreLugarTrabajo' | 'redSocial'
  > = {},
): GuardarPerfilProfesionalDto => ({
  anosExperiencia: 8,
  modalidad: MODALIDADES_TRABAJO.SALON_PROPIO,
  especialidades: [ESPECIALIDADES.COLORACION_TINTURAS],
  nombreLugarTrabajo: opcionales.nombreLugarTrabajo,
  redSocial: opcionales.redSocial,
});

describe('PerfilProfesionalService', () => {
  let prisma: ReturnType<typeof crearPrisma>['prisma'];
  let tx: ReturnType<typeof crearPrisma>['tx'];
  let servicio: PerfilProfesionalService;

  beforeEach(() => {
    ({ prisma, tx } = crearPrisma());
    servicio = new PerfilProfesionalService(prisma as unknown as PrismaService);
  });

  describe('guardar', () => {
    it('E10-H5 · perfil guardado: lo crea o reemplaza en la cuenta, sin lugar de trabajo', async () => {
      await servicio.guardar(CODIGO, dtoBase());

      expect(tx.$queryRaw).toHaveBeenCalled();
      const { where, create, update } =
        tx.perfilProfesional.upsert.mock.calls[0][0];
      const esperado = {
        anosExperiencia: 8,
        modalidad: MODALIDADES_TRABAJO.SALON_PROPIO,
        especialidades: [ESPECIALIDADES.COLORACION_TINTURAS],
        nombreLugarTrabajo: null,
        redSocial: null,
      };
      expect(where).toEqual({ usuarioId: 7 });
      expect(create).toEqual({ usuarioId: 7, ...esperado });
      expect(update).toEqual(esperado);
    });

    it('E10-H5 · perfil guardado: guarda el lugar de trabajo y la red social si vienen', async () => {
      await servicio.guardar(
        CODIGO,
        dtoBase({
          nombreLugarTrabajo: 'Salón Bella Vista',
          redSocial: 'https://www.instagram.com/bellavista.salon',
        }),
      );

      expect(tx.perfilProfesional.upsert.mock.calls[0][0].update).toMatchObject(
        {
          nombreLugarTrabajo: 'Salón Bella Vista',
          redSocial: 'https://www.instagram.com/bellavista.salon',
        },
      );
    });

    it('E10-H5 · cuenta sin verificar: si en la base ya no es profesional activa, 403 sin guardar', async () => {
      tx.usuario.findFirst.mockResolvedValue(null);

      await expect(servicio.guardar(CODIGO, dtoBase())).rejects.toThrow(
        ForbiddenException,
      );
      expect(tx.usuario.findFirst.mock.calls[0][0].where).toEqual({
        id: 7,
        rol: ROLES.PROFESIONAL,
        activo: true,
      });
      expect(tx.perfilProfesional.upsert).not.toHaveBeenCalled();
    });
  });

  describe('obtener', () => {
    it('E10-H5 · devuelve el perfil de la cuenta del token', async () => {
      const perfil = dtoBase({ nombreLugarTrabajo: null });
      prisma.perfilProfesional.findFirst.mockResolvedValue(perfil);

      await expect(servicio.obtener(CODIGO)).resolves.toBe(perfil);
      expect(prisma.perfilProfesional.findFirst.mock.calls[0][0].where).toEqual(
        { usuario: { codigoPublico: CODIGO } },
      );
    });

    it('responde 404 si aún no completa el perfil', async () => {
      await expect(servicio.obtener(CODIGO)).rejects.toThrow(
        new NotFoundException(SIN_PERFIL),
      );
    });
  });
});
