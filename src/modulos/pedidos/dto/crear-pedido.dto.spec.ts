import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { mensajesValidacion } from '../../../common/validacion/mensajes-validacion.js';
import { CrearPedidoDto } from './crear-pedido.dto.js';

const mensajes = async (datos: object) =>
  mensajesValidacion(await validate(plainToInstance(CrearPedidoDto, datos)));

const base = () => ({
  claveIdempotencia: '0f8fad5b-d9cb-469f-a165-70867728950e',
  tipoEntrega: 'retiro',
  tipoDocumento: 'boleta',
});

describe('CrearPedidoDto', () => {
  it('E5-H3 · pedido creado: acepta retiro con boleta y despacho con factura', async () => {
    expect(await mensajes(base())).toEqual([]);
    expect(
      await mensajes({
        ...base(),
        tipoEntrega: 'despacho',
        direccionId: 12,
        tipoDocumento: 'factura',
        datosFacturacionId: 3,
      }),
    ).toEqual([]);
  });

  it('E5-H3 · doble confirmación: la clave de idempotencia es un UUID obligatorio', async () => {
    for (const claveIdempotencia of [undefined, '', 'abc', 123]) {
      expect(await mensajes({ ...base(), claveIdempotencia })).toEqual([
        'La clave de idempotencia es obligatoria y debe ser un UUID.',
      ]);
    }
  });

  it('rechaza una entrega o un documento que no existen', async () => {
    expect(await mensajes({ ...base(), tipoEntrega: 'dron' })).toEqual([
      'El tipo de entrega es obligatorio y debe ser uno de estos: despacho, retiro.',
    ]);
    expect(await mensajes({ ...base(), tipoDocumento: 'ticket' })).toEqual([
      'El tipo de documento es obligatorio y debe ser uno de estos: boleta, factura.',
    ]);
  });

  it('el despacho exige una dirección válida y el retiro no la admite', async () => {
    expect(await mensajes({ ...base(), tipoEntrega: 'despacho' })).toEqual([
      'La dirección es obligatoria para el despacho a domicilio.',
    ]);
    expect(
      await mensajes({ ...base(), tipoEntrega: 'despacho', direccionId: 0 }),
    ).toEqual(['La dirección indicada no es válida.']);
    expect(await mensajes({ ...base(), direccionId: 12 })).toEqual([
      'La dirección solo se indica con despacho a domicilio.',
    ]);
  });

  it('la factura exige datos de facturación válidos y la boleta no los admite', async () => {
    expect(await mensajes({ ...base(), tipoDocumento: 'factura' })).toEqual([
      'Los datos de facturación son obligatorios para la factura.',
    ]);
    expect(
      await mensajes({
        ...base(),
        tipoDocumento: 'factura',
        datosFacturacionId: '3',
      }),
    ).toEqual(['Los datos de facturación indicados no son válidos.']);
    expect(await mensajes({ ...base(), datosFacturacionId: 3 })).toEqual([
      'Los datos de facturación solo se indican con factura.',
    ]);
  });
});
