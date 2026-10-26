import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { mensajesValidacion } from '../../../common/validacion/mensajes-validacion.js';
import { ActualizarPackDto } from './actualizar-pack.dto.js';
import { CrearPackDto } from './crear-pack.dto.js';

const mensajes = async (datos: object) =>
  mensajesValidacion(await validate(plainToInstance(CrearPackDto, datos)));

const mensajesEdicion = async (datos: object) =>
  mensajesValidacion(await validate(plainToInstance(ActualizarPackDto, datos)));

const packBase = () => ({
  sku: 'PACK-REP-DUO',
  nombre: 'Dúo reparador',
  descripcion: 'Shampoo y acondicionador a precio de promoción.',
  canalVenta: 'general',
  componentes: [
    { formatoId: 11, cantidad: 1 },
    { formatoId: 12, cantidad: 1 },
  ],
});

describe('CrearPackDto', () => {
  it('E3-H6 · pack creado: acepta SKU, datos, canal, vigencia opcional y formatos con sus cantidades', async () => {
    expect(await mensajes(packBase())).toEqual([]);
    expect(
      await mensajes({
        ...packBase(),
        fechaInicioVigencia: '2026-11-01',
        fechaFinVigencia: '2026-11-30',
      }),
    ).toEqual([]);
    // Un «3x2» de un mismo formato también es un pack
    expect(
      await mensajes({
        ...packBase(),
        componentes: [{ formatoId: 11, cantidad: 3 }],
      }),
    ).toEqual([]);
  });

  it('E3-H6 · pack creado: indica lo que falta', async () => {
    expect(await mensajes({})).toEqual([
      'El SKU es obligatorio.',
      'El nombre del pack es obligatorio.',
      'La descripción del pack es obligatoria.',
      'El canal de venta es obligatorio.',
      'Indica los formatos del pack.',
    ]);
    for (const componentes of [[], null, 'x', { formatoId: 11 }]) {
      expect(await mensajes({ ...packBase(), componentes })).toEqual([
        'Indica los formatos del pack.',
      ]);
    }
  });

  it('E3-H6 · pack creado: un formato solo, una vez, no es un pack', async () => {
    expect(
      await mensajes({
        ...packBase(),
        componentes: [{ formatoId: 11, cantidad: 1 }],
      }),
    ).toEqual([
      'Un pack debe sumar al menos 2 unidades: agrega otro formato o aumenta la cantidad.',
    ]);
  });

  it('E3-H6 · pack creado: cada formato aparece una vez, con cantidad entera de 1 a 99', async () => {
    expect(
      await mensajes({
        ...packBase(),
        componentes: [
          { formatoId: 11, cantidad: 1 },
          { formatoId: 11, cantidad: 2 },
        ],
      }),
    ).toEqual([
      'Cada formato debe aparecer una sola vez en el pack: indica su cantidad.',
    ]);
    for (const cantidad of [0, -1, 1.5, '2', 100]) {
      expect(
        await mensajes({
          ...packBase(),
          componentes: [
            { formatoId: 11, cantidad },
            { formatoId: 12, cantidad: 1 },
          ],
        }),
      ).toEqual([
        'La cantidad del componente debe ser un número entero mayor que 0 y hasta 99.',
      ]);
    }
    expect(
      await mensajes({ ...packBase(), componentes: [{ cantidad: 2 }] }),
    ).toEqual(['Indica el formato de cada componente del pack.']);
  });

  it('acepta hasta 20 formatos distintos', async () => {
    const componentes = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ formatoId: i + 1, cantidad: 1 }));

    expect(
      await mensajes({ ...packBase(), componentes: componentes(20) }),
    ).toEqual([]);
    expect(
      await mensajes({ ...packBase(), componentes: componentes(21) }),
    ).toEqual(['Un pack tiene hasta 20 formatos distintos.']);
  });

  it('rechaza fechas de vigencia inexistentes y un canal desconocido', async () => {
    expect(
      await mensajes({
        ...packBase(),
        fechaInicioVigencia: '2026-02-30',
        canalVenta: 'mayorista',
      }),
    ).toEqual([
      'El canal de venta debe ser uno de estos: general, profesional.',
      'La fecha de inicio de la vigencia debe ser una fecha válida con el formato AAAA-MM-DD.',
    ]);
  });
});

describe('ActualizarPackDto', () => {
  it('E3-H6 · acepta un cambio parcial y null para quitar una fecha de vigencia', async () => {
    expect(await mensajesEdicion({ nombre: 'Trío reparador' })).toEqual([]);
    expect(await mensajesEdicion({ fechaFinVigencia: null })).toEqual([]);
    expect(await mensajesEdicion({})).toEqual([]);
  });

  it('E3-H6 · los componentes que llegan siguen las mismas reglas que al crear', async () => {
    expect(await mensajesEdicion({ componentes: [] })).toEqual([
      'Indica los formatos del pack.',
    ]);
    expect(
      await mensajesEdicion({
        componentes: [{ formatoId: 11, cantidad: 1 }],
      }),
    ).toEqual([
      'Un pack debe sumar al menos 2 unidades: agrega otro formato o aumenta la cantidad.',
    ]);
  });

  it('lo que llega no puede quedar vacío', async () => {
    expect(
      await mensajesEdicion({ nombre: '  ', sku: '', canalVenta: null }),
    ).toEqual([
      'El SKU es obligatorio.',
      'El nombre del pack es obligatorio.',
      'El canal de venta es obligatorio.',
    ]);
  });
});
