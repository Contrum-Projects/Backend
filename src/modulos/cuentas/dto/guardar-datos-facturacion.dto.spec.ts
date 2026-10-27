import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { mensajesValidacion } from '../../../common/validacion/mensajes-validacion.js';
import {
  ActualizarDatosFacturacionDto,
  CrearDatosFacturacionDto,
} from './guardar-datos-facturacion.dto.js';

const probar = async <T extends object>(
  clase: new () => T,
  entrada: object,
) => {
  const dto = plainToInstance(clase, entrada);
  const errores = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return {
    dto,
    campos: errores.map((e) => e.property).sort(),
    mensajes: mensajesValidacion(errores),
  };
};

const completos = {
  rut: '76.086.429-3',
  razonSocial: 'Peluquería Los Aromos SpA',
  giro: 'Servicios de peluquería',
  direccion: 'Av. Providencia 1234',
  comuna: '13123',
};

describe('CrearDatosFacturacionDto', () => {
  it('E9-H2 · datos completos: los acepta, normaliza el RUT y recorta los textos', async () => {
    const { dto, campos } = await probar(CrearDatosFacturacionDto, {
      ...completos,
      razonSocial: '  Peluquería Los Aromos SpA ',
      correoFacturacion: ' Facturas@LosAromos.cl ',
    });

    expect(campos).toEqual([]);
    expect(dto).toMatchObject({
      rut: '76086429-3',
      razonSocial: 'Peluquería Los Aromos SpA',
      correoFacturacion: 'facturas@losaromos.cl',
    });
  });

  it('E9-H2 · el correo de facturación es opcional y un texto vacío equivale a no tenerlo', async () => {
    expect((await probar(CrearDatosFacturacionDto, completos)).campos).toEqual(
      [],
    );
    const { dto, campos } = await probar(CrearDatosFacturacionDto, {
      ...completos,
      correoFacturacion: '',
    });
    expect(campos).toEqual([]);
    expect(dto.correoFacturacion).toBeNull();
  });

  it('E9-H2 · datos incompletos: indica en español cada dato que falta', async () => {
    const { campos, mensajes } = await probar(CrearDatosFacturacionDto, {});

    expect(campos).toEqual([
      'comuna',
      'direccion',
      'giro',
      'razonSocial',
      'rut',
    ]);
    expect(mensajes).toEqual(
      expect.arrayContaining([
        'El RUT es obligatorio.',
        'La razón social es obligatoria.',
        'El giro es obligatorio.',
        'La dirección es obligatoria.',
        'La comuna no es válida.',
      ]),
    );
  });

  it('E9-H2 · un dato en blanco cuenta como faltante', async () => {
    const { campos } = await probar(CrearDatosFacturacionDto, {
      ...completos,
      giro: '   ',
    });
    expect(campos).toEqual(['giro']);
  });

  it('rechaza un RUT con dígito verificador incorrecto, un correo inválido y textos demasiado largos', async () => {
    const { campos, mensajes } = await probar(CrearDatosFacturacionDto, {
      ...completos,
      rut: '76086429-4',
      correoFacturacion: 'no-es-correo',
      razonSocial: 'x'.repeat(151),
      direccion: 'x'.repeat(201),
    });

    expect(campos).toEqual([
      'correoFacturacion',
      'direccion',
      'razonSocial',
      'rut',
    ]);
    expect(mensajes).toEqual(
      expect.arrayContaining([
        'El RUT no es válido.',
        'El correo no es válido.',
        'La razón social no puede superar los 150 caracteres.',
        'La dirección no puede superar los 200 caracteres.',
      ]),
    );
  });

  it('no admite campos que no son del registro', async () => {
    const { mensajes } = await probar(CrearDatosFacturacionDto, {
      ...completos,
      usuarioId: 1,
    });
    expect(mensajes).toEqual(['El campo «usuarioId» no se admite.']);
  });
});

describe('ActualizarDatosFacturacionDto', () => {
  it('acepta un cambio parcial', async () => {
    expect(
      (await probar(ActualizarDatosFacturacionDto, { giro: 'Comercio' }))
        .campos,
    ).toEqual([]);
  });

  it('acepta null en el correo de facturación para borrarlo', async () => {
    const { dto, campos } = await probar(ActualizarDatosFacturacionDto, {
      correoFacturacion: null,
    });
    expect(campos).toEqual([]);
    expect(dto.correoFacturacion).toBeNull();
  });

  it('los datos obligatorios no se pueden vaciar ni poner en null', async () => {
    const { campos } = await probar(ActualizarDatosFacturacionDto, {
      rut: null,
      razonSocial: ' ',
      giro: null,
      direccion: '',
      comuna: '12',
    });
    expect(campos).toEqual([
      'comuna',
      'direccion',
      'giro',
      'razonSocial',
      'rut',
    ]);
  });
});
