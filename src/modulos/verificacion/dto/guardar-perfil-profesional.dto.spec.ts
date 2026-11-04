import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ESPECIALIDADES,
  MODALIDADES_TRABAJO,
} from '../../../common/dominio/valores.js';
import { mensajesValidacion } from '../../../common/validacion/mensajes-validacion.js';
import {
  ESPECIALIDAD_INVALIDA,
  ESPECIALIDAD_REPETIDA,
  FALTA_ESPECIALIDAD,
  GuardarPerfilProfesionalDto,
  MAXIMO_LUGAR_TRABAJO,
  MAXIMO_RED_SOCIAL,
} from './guardar-perfil-profesional.dto.js';

const probar = async (entrada: object) => {
  const dto = plainToInstance(GuardarPerfilProfesionalDto, entrada);
  const errores = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, mensajes: mensajesValidacion(errores) };
};

const completo = () => ({
  anosExperiencia: 8,
  modalidad: MODALIDADES_TRABAJO.SALON_PROPIO,
  especialidades: [ESPECIALIDADES.COLORACION_TINTURAS],
});

const MENSAJE_ANOS =
  'La cantidad de años de experiencia debe ser un número entero desde 0 y hasta 40.';
const MENSAJE_MODALIDAD = /^La modalidad de trabajo es obligatoria/;

describe('GuardarPerfilProfesionalDto', () => {
  it('E10-H5 · perfil guardado: acepta los obligatorios sin lugar de trabajo ni red social', async () => {
    const { mensajes, dto } = await probar(completo());

    expect(mensajes).toEqual([]);
    expect(dto.nombreLugarTrabajo).toBeUndefined();
  });

  it('E10-H5 · perfil guardado: acepta el lugar de trabajo y la red social, recortados', async () => {
    const { mensajes, dto } = await probar({
      ...completo(),
      especialidades: [ESPECIALIDADES.CORTE_DAMA, ESPECIALIDADES.ALISADOS],
      modalidad: ` ${MODALIDADES_TRABAJO.ARRIENDO_SILLON} `,
      nombreLugarTrabajo: '  Salón Bella Vista  ',
      redSocial: ' @bellavista.salon ',
    });

    expect(mensajes).toEqual([]);
    expect(dto.modalidad).toBe(MODALIDADES_TRABAJO.ARRIENDO_SILLON);
    expect(dto.nombreLugarTrabajo).toBe('Salón Bella Vista');
    expect(dto.redSocial).toBe('@bellavista.salon');
  });

  it('E10-H5 · un lugar de trabajo vacío o null queda sin valor', async () => {
    for (const valor of [null, '   ']) {
      const { mensajes, dto } = await probar({
        ...completo(),
        nombreLugarTrabajo: valor,
        redSocial: valor,
      });
      expect(mensajes).toEqual([]);
      expect(dto.nombreLugarTrabajo).toBeNull();
      expect(dto.redSocial).toBeNull();
    }
  });

  it('E10-H5 · datos obligatorios faltantes: sin cuerpo indica los tres que faltan', async () => {
    const { mensajes } = await probar({});

    expect(mensajes).toHaveLength(3);
    expect(mensajes[0]).toBe(
      'La cantidad de años de experiencia es obligatoria.',
    );
    expect(mensajes[1]).toMatch(MENSAJE_MODALIDAD);
    expect(mensajes[2]).toBe(FALTA_ESPECIALIDAD);
  });

  it('E10-H5 · datos obligatorios faltantes: sin especialidades o con la lista vacía', async () => {
    for (const especialidades of [undefined, null, [], 'corte_dama']) {
      expect(
        (await probar({ ...completo(), especialidades })).mensajes,
      ).toEqual([FALTA_ESPECIALIDAD]);
    }
  });

  it('E10-H5 · datos obligatorios faltantes: sin modalidad o con una que no está en la lista', async () => {
    for (const modalidad of [undefined, '', 'otra']) {
      const { mensajes } = await probar({ ...completo(), modalidad });
      expect(mensajes).toHaveLength(1);
      expect(mensajes[0]).toMatch(MENSAJE_MODALIDAD);
    }
  });

  it('años de experiencia: entero de 0 a 40', async () => {
    for (const anosExperiencia of [0, 40]) {
      expect(
        (await probar({ ...completo(), anosExperiencia })).mensajes,
      ).toEqual([]);
    }
    for (const anosExperiencia of [-1, 41, 2.5, '8']) {
      expect(
        (await probar({ ...completo(), anosExperiencia })).mensajes,
      ).toEqual([MENSAJE_ANOS]);
    }
  });

  it('rechaza especialidades fuera de la lista o repetidas', async () => {
    expect(
      (
        await probar({
          ...completo(),
          especialidades: [ESPECIALIDADES.CORTE_DAMA, 'maquillaje'],
        })
      ).mensajes,
    ).toEqual([ESPECIALIDAD_INVALIDA]);
    expect(
      (
        await probar({
          ...completo(),
          especialidades: [
            ESPECIALIDADES.CORTE_DAMA,
            ESPECIALIDADES.CORTE_DAMA,
          ],
        })
      ).mensajes,
    ).toEqual([ESPECIALIDAD_REPETIDA]);
  });

  it('acepta todas las especialidades a la vez', async () => {
    expect(
      (
        await probar({
          ...completo(),
          especialidades: Object.values(ESPECIALIDADES),
        })
      ).mensajes,
    ).toEqual([]);
  });

  it('rechaza textos opcionales sobre su largo y campos que no están en el perfil', async () => {
    expect(
      (
        await probar({
          ...completo(),
          nombreLugarTrabajo: 'x'.repeat(MAXIMO_LUGAR_TRABAJO + 1),
          redSocial: 'x'.repeat(MAXIMO_RED_SOCIAL + 1),
        })
      ).mensajes,
    ).toEqual([
      `El lugar de trabajo no puede superar los ${MAXIMO_LUGAR_TRABAJO} caracteres.`,
      `La red social no puede superar los ${MAXIMO_RED_SOCIAL} caracteres.`,
    ]);
    expect((await probar({ ...completo(), comunaId: 3 })).mensajes).toEqual([
      'El campo «comunaId» no se admite.',
    ]);
  });
});
