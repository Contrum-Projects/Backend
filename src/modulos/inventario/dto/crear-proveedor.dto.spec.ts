import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CrearProveedorDto } from './crear-proveedor.dto.js';

const probar = (entrada: object) => {
  const dto = plainToInstance(CrearProveedorDto, entrada);
  return validate(dto).then((errores) => ({
    dto,
    campos: errores.map((e) => e.property).sort(),
  }));
};

describe('CrearProveedorDto', () => {
  it('E11-H1 · RUT nuevo: acepta lo mínimo (RUT y razón social) y normaliza el RUT', async () => {
    const { dto, campos } = await probar({
      rut: ' 76.086.428-5 ',
      razonSocial: '  Distribuidora Capilar SpA ',
    });

    expect(campos).toEqual([]);
    expect(dto.rut).toBe('76086428-5');
    expect(dto.razonSocial).toBe('Distribuidora Capilar SpA');
  });

  it('acepta el RUT sin puntos ni guion y con K en minúscula', async () => {
    expect((await probar({ rut: '760864285', razonSocial: 'A' })).dto.rut).toBe(
      '76086428-5',
    );
    expect(
      (await probar({ rut: '10.000.013-k', razonSocial: 'A' })).dto.rut,
    ).toBe('10000013-K');
  });

  it('rechaza un RUT con dígito verificador incorrecto o sin formato de RUT', async () => {
    expect(
      (await probar({ rut: '76.086.428-9', razonSocial: 'A' })).campos,
    ).toEqual(['rut']);
    expect((await probar({ rut: 'abc', razonSocial: 'A' })).campos).toEqual([
      'rut',
    ]);
  });

  it('rechaza si faltan el RUT o la razón social', async () => {
    expect((await probar({})).campos).toEqual(['razonSocial', 'rut']);
    expect(
      (await probar({ rut: '76086428-5', razonSocial: '   ' })).campos,
    ).toEqual(['razonSocial']);
  });

  it('rechaza un correo de contacto inválido y pasa el válido a minúsculas', async () => {
    expect(
      (await probar({ rut: '76086428-5', razonSocial: 'A', email: 'no-es' }))
        .campos,
    ).toEqual(['email']);
    expect(
      (
        await probar({
          rut: '76086428-5',
          razonSocial: 'A',
          email: ' Ventas@Distribuidora.CL ',
        })
      ).dto.email,
    ).toBe('ventas@distribuidora.cl');
  });

  it('rechaza textos más largos que la columna', async () => {
    expect(
      (await probar({ rut: '76086428-5', razonSocial: 'x'.repeat(151) }))
        .campos,
    ).toEqual(['razonSocial']);
  });
});
