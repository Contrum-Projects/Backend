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
  RED_SOCIAL_INVALIDA,
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
      redSocial: ' https://www.instagram.com/bellavista.salon ',
    });

    expect(mensajes).toEqual([]);
    expect(dto.modalidad).toBe(MODALIDADES_TRABAJO.ARRIENDO_SILLON);
    expect(dto.nombreLugarTrabajo).toBe('Salón Bella Vista');
    expect(dto.redSocial).toBe('https://www.instagram.com/bellavista.salon');
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
          redSocial: `https://instagram.com/${'x'.repeat(MAXIMO_RED_SOCIAL)}`,
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

  describe('red social', () => {
    const redSocial = async (valor: unknown) =>
      (await probar({ ...completo(), redSocial: valor })).mensajes;

    it('acepta el enlace https:// al perfil en Instagram, Facebook o TikTok, con o sin www', async () => {
      for (const valor of [
        'https://instagram.com/bellavista.salon',
        'https://www.instagram.com/bellavista.salon/',
        'https://facebook.com/bellavista.salon',
        'https://www.facebook.com/profile.php?id=100012345678',
        'https://tiktok.com/@bellavista',
        'https://www.tiktok.com/@bellavista?lang=es',
        'https://WWW.Instagram.COM/bellavista.salon',
      ]) {
        expect(await redSocial(valor)).toEqual([]);
      }
    });

    it('rechaza otros sitios, subdominios, acortadores y dominios parecidos', async () => {
      for (const valor of [
        'https://salon.cl/bellavista',
        'https://x.com/bellavista',
        'https://m.facebook.com/bellavista',
        'https://fb.com/bellavista',
        'https://vm.tiktok.com/ZMabc123/',
        'https://instagram.com.sitio-falso.cl/bellavista',
        'https://falso-instagram.com/bellavista',
        'https://instagram.co/bellavista',
      ]) {
        expect(await redSocial(valor)).toEqual([RED_SOCIAL_INVALIDA]);
      }
    });

    it('rechaza enlaces que solo parecen de la red: usuario, puerto o sin perfil', async () => {
      for (const valor of [
        'https://instagram.com@sitio-falso.cl/bellavista',
        'https://usuario:clave@instagram.com/bellavista',
        'https://instagram.com:8443/bellavista',
        'https://instagram.com',
        'https://www.instagram.com/',
      ]) {
        expect(await redSocial(valor)).toEqual([RED_SOCIAL_INVALIDA]);
      }
    });

    it('rechaza un @usuario sin enlace', async () => {
      for (const valor of ['@bellavista.salon', 'bellavista.salon']) {
        expect(await redSocial(valor)).toEqual([RED_SOCIAL_INVALIDA]);
      }
    });

    it('rechaza esquemas que no son https:// (XSS guardado si se muestra como enlace)', async () => {
      for (const valor of [
        'javascript:alert(document.cookie)',
        'JAVASCRIPT:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'http://instagram.com/bellavista',
        'vbscript:msgbox(1)',
        '//instagram.com/bellavista',
      ]) {
        expect(await redSocial(valor)).toEqual([RED_SOCIAL_INVALIDA]);
      }
    });

    it('rechaza enlaces con caracteres de control, espacios o comillas, y lo que no es texto', async () => {
      for (const valor of [
        'https://instagram.com/a\u0000b',
        'https://instagram.com/a b',
        'https://instagram.com/"onmouseover="alert(1)',
        'https://instagram.com/<script>',
        'https://instagram.com/a\\b',
        'https://',
        123,
      ]) {
        expect(await redSocial(valor)).toEqual([RED_SOCIAL_INVALIDA]);
      }
    });
  });
});
