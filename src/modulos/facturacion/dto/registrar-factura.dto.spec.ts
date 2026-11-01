import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegistrarFacturaDto } from './registrar-factura.dto.js';

const errores = async (cuerpo: object) => {
  const dto = plainToInstance(RegistrarFacturaDto, cuerpo);
  const fallas = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return fallas.flatMap((falla) => Object.values(falla.constraints ?? {}));
};

describe('RegistrarFacturaDto', () => {
  it('E9-H3 · acepta el folio como texto (así llega en un formulario) y la fecha es opcional', async () => {
    expect(await errores({ folio: '4521' })).toEqual([]);
    expect(
      await errores({ folio: ' 4521 ', fechaEmision: '2026-10-30' }),
    ).toEqual([]);
    expect(
      plainToInstance(RegistrarFacturaDto, { folio: ' 4521 ' }).folio,
    ).toBe(4521);
  });

  it('E9-H3 · el folio es obligatorio y debe ser un entero positivo que cabe en la base', async () => {
    const mensaje = 'El folio debe ser un número entero positivo.';
    for (const folio of [
      undefined,
      '',
      'abc',
      '0',
      '-3',
      '12.5',
      '2147483648',
    ]) {
      expect(await errores({ folio })).toEqual([mensaje]);
    }
  });

  it('E9-H3 · la fecha de emisión debe existir en el calendario', async () => {
    expect(await errores({ folio: '1', fechaEmision: '2026-02-30' })).toEqual([
      'La fecha de emisión debe ser una fecha válida con el formato AAAA-MM-DD.',
    ]);
    expect(
      await errores({ folio: '1', fechaEmision: '30-10-2026' }),
    ).toHaveLength(1);
  });

  it('no admite campos de más', async () => {
    expect(await errores({ folio: '1', montoTotal: 100 })).toHaveLength(1);
  });
});
