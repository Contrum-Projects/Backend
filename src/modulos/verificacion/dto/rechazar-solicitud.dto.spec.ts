import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { mensajesValidacion } from '../../../common/validacion/mensajes-validacion.js';
import {
  MAXIMO_MOTIVO_RECHAZO,
  MINIMO_MOTIVO_RECHAZO,
  RechazarSolicitudDto,
} from './rechazar-solicitud.dto.js';

const probar = async (entrada: object) => {
  const dto = plainToInstance(RechazarSolicitudDto, entrada);
  const errores = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, mensajes: mensajesValidacion(errores) };
};

describe('RechazarSolicitudDto', () => {
  it('E10-H3 · rechazo con motivo: acepta el motivo y lo recorta', async () => {
    const { dto, mensajes } = await probar({
      motivo: '  El certificado no es legible.  ',
    });

    expect(mensajes).toEqual([]);
    expect(dto.motivo).toBe('El certificado no es legible.');
  });

  it('E10-H3 · rechazo sin motivo: falta, vacío, en blanco o no es texto, indica que el motivo es obligatorio', async () => {
    for (const entrada of [
      {},
      { motivo: null },
      { motivo: '' },
      { motivo: '    ' },
      { motivo: 123 },
    ]) {
      expect((await probar(entrada)).mensajes).toEqual([
        'El motivo del rechazo es obligatorio.',
      ]);
    }
  });

  it(`E10-H3 · rechazo sin motivo: menos de ${MINIMO_MOTIVO_RECHAZO} caracteres no basta`, async () => {
    expect((await probar({ motivo: '  No.  ' })).mensajes).toEqual([
      `El motivo del rechazo debe tener al menos ${MINIMO_MOTIVO_RECHAZO} caracteres.`,
    ]);
    expect(
      (await probar({ motivo: 'x'.repeat(MINIMO_MOTIVO_RECHAZO) })).mensajes,
    ).toEqual([]);
  });

  it(`rechaza un motivo de más de ${MAXIMO_MOTIVO_RECHAZO} caracteres`, async () => {
    expect(
      (await probar({ motivo: 'x'.repeat(MAXIMO_MOTIVO_RECHAZO) })).mensajes,
    ).toEqual([]);
    expect(
      (await probar({ motivo: 'x'.repeat(MAXIMO_MOTIVO_RECHAZO + 1) }))
        .mensajes,
    ).toEqual([
      `El motivo del rechazo no puede superar los ${MAXIMO_MOTIVO_RECHAZO} caracteres.`,
    ]);
  });

  it('no admite campos de más', async () => {
    expect(
      (await probar({ motivo: 'Documento ilegible.', estado: 'aprobada' }))
        .mensajes,
    ).toEqual(['El campo «estado» no se admite.']);
  });
});
