import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ActualizarDireccionDto,
  CrearDireccionDto,
} from './guardar-direccion.dto.js';

const probar = <T extends object>(clase: new () => T, entrada: object) => {
  const dto = plainToInstance(clase, entrada);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true }).then(
    (errores) => ({ dto, campos: errores.map((e) => e.property).sort() }),
  );
};

describe('CrearDireccionDto', () => {
  it('acepta una dirección completa y recorta los textos', async () => {
    const { dto, campos } = await probar(CrearDireccionDto, {
      calle: '  Av. Providencia ',
      numero: ' 1234 ',
      referencia: '',
      comuna: '13123',
      esPrincipal: true,
    });

    expect(campos).toEqual([]);
    expect(dto).toMatchObject({
      calle: 'Av. Providencia',
      numero: '1234',
      referencia: null,
    });
  });

  it('exige calle, número y una comuna de 5 dígitos; esPrincipal debe ser booleano', async () => {
    const { campos } = await probar(CrearDireccionDto, {
      calle: ' ',
      comuna: '131',
      esPrincipal: 'si',
    });

    expect(campos).toEqual(['calle', 'comuna', 'esPrincipal', 'numero']);
  });
});

describe('ActualizarDireccionDto', () => {
  it('acepta un cambio parcial', async () => {
    expect(
      (await probar(ActualizarDireccionDto, { referencia: 'Casa 2' })).campos,
    ).toEqual([]);
  });

  it('no permite vaciar los datos obligatorios ni cambiar la principal', async () => {
    const { campos } = await probar(ActualizarDireccionDto, {
      calle: null,
      numero: '',
      comuna: null,
      esPrincipal: true,
    });

    expect(campos).toEqual(['calle', 'comuna', 'esPrincipal', 'numero']);
  });
});
