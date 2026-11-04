import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { mensajesValidacion } from '../../../common/validacion/mensajes-validacion.js';
import { CambiarRolDto } from './cambiar-rol.dto.js';

const probar = async (entrada: object) => {
  const dto = plainToInstance(CambiarRolDto, entrada);
  const errores = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, mensajes: mensajesValidacion(errores) };
};

const MOTIVO = 'Dejó de ejercer como peluquera según nos informó.';

describe('CambiarRolDto', () => {
  it('E13-H3 · rol del personal degradado: acepta vendedor o bodeguero sin motivo', async () => {
    for (const rol of ['vendedor', 'bodeguero']) {
      expect((await probar({ rol })).mensajes).toEqual([]);
    }
  });

  it('E13-H3 · rol del personal degradado: el motivo es opcional; vacío o null queda sin valor', async () => {
    for (const motivo of [null, '', '   ']) {
      const { dto, mensajes } = await probar({ rol: 'vendedor', motivo });
      expect(mensajes).toEqual([]);
      expect(dto.motivo).toBeNull();
    }
  });

  it('E13-H3 · profesional que vuelve a cliente: acepta el motivo y lo recorta', async () => {
    const { dto, mensajes } = await probar({
      rol: 'cliente',
      motivo: `  ${MOTIVO}  `,
    });

    expect(mensajes).toEqual([]);
    expect(dto.motivo).toBe(MOTIVO);
  });

  it('E13-H3 · profesional que vuelve a cliente: sin motivo, vacío o en blanco, indica que es obligatorio', async () => {
    for (const entrada of [
      { rol: 'cliente' },
      { rol: 'cliente', motivo: null },
      { rol: 'cliente', motivo: '' },
      { rol: 'cliente', motivo: '    ' },
    ]) {
      expect((await probar(entrada)).mensajes).toEqual([
        'El motivo es obligatorio al quitar el rol profesional.',
      ]);
    }
  });

  it('E13-H3 · el motivo enviado tiene de 10 a 1000 caracteres y es texto', async () => {
    expect(
      (await probar({ rol: 'cliente', motivo: 'corto' })).mensajes,
    ).toEqual(['El motivo debe tener al menos 10 caracteres.']);
    expect(
      (await probar({ rol: 'vendedor', motivo: 'x'.repeat(1001) })).mensajes,
    ).toEqual(['El motivo no puede superar los 1000 caracteres.']);
    expect((await probar({ rol: 'cliente', motivo: 123 })).mensajes).toEqual([
      'El motivo debe ser un texto.',
    ]);
  });

  it('E13-H3 · solo se baja a vendedor, bodeguero o cliente: otro rol responde con un mensaje', async () => {
    for (const rol of ['administrador', 'profesional', 'dueña', undefined]) {
      expect((await probar({ rol, motivo: MOTIVO })).mensajes).toEqual([
        'El rol debe ser vendedor, bodeguero o cliente.',
      ]);
    }
  });
});
