import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ActualizarDatosDto } from './actualizar-datos.dto.js';

const probar = (entrada: object) => {
  const dto = plainToInstance(ActualizarDatosDto, entrada);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true }).then(
    (errores) => ({ dto, campos: errores.map((e) => e.property).sort() }),
  );
};

describe('ActualizarDatosDto', () => {
  it('acepta un cambio parcial, recorta los textos y normaliza el RUT', async () => {
    const { dto, campos } = await probar({
      nombre: '  Camila ',
      rut: '12.345.678-5',
    });

    expect(campos).toEqual([]);
    expect(dto.nombre).toBe('Camila');
    expect(dto.rut).toBe('12345678-5');
    expect(dto.apellido).toBeUndefined();
  });

  it('un texto vacío en un dato opcional lo borra (null)', async () => {
    const { dto, campos } = await probar({
      telefono: '  ',
      rut: '',
      fechaNacimiento: '',
      genero: '',
    });

    expect(campos).toEqual([]);
    expect(dto).toMatchObject({
      telefono: null,
      rut: null,
      fechaNacimiento: null,
      genero: null,
    });
  });

  it('no permite dejar vacíos ni nulos el nombre y el apellido', async () => {
    expect((await probar({ nombre: '  ', apellido: null })).campos).toEqual([
      'apellido',
      'nombre',
    ]);
  });

  it('rechaza un RUT inválido y una fecha mal escrita', async () => {
    expect(
      (await probar({ rut: '12.345.678-9', fechaNacimiento: '21-05-1990' }))
        .campos,
    ).toEqual(['fechaNacimiento', 'rut']);
  });

  it('el correo no se edita aquí', async () => {
    expect((await probar({ email: 'otro@correo.cl' })).campos).toEqual([
      'email',
    ]);
  });
});
