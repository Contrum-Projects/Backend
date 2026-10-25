import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { mensajesValidacion } from '../../../common/validacion/mensajes-validacion.js';
import { CrearEntradaDto } from './crear-entrada.dto.js';

const mensajes = async (datos: object) =>
  mensajesValidacion(await validate(plainToInstance(CrearEntradaDto, datos)));

const entradaBase = () => ({
  proveedorId: 3,
  fechaRecepcion: '2026-10-24',
  tipoDocumento: 'factura',
  numeroDocumento: 'F-12345',
  ubicacionId: 1,
  detalles: [
    { formatoId: 11, cantidad: 24, costoUnitarioNeto: 3500 },
    { formatoId: 12, cantidad: 6, costoUnitarioNeto: 1990.5 },
  ],
});

describe('CrearEntradaDto', () => {
  it('E11-H2 · entrada registrada: acepta proveedor, fecha, factura o guía y el detalle con cantidad y costo', async () => {
    expect(await mensajes(entradaBase())).toEqual([]);
    expect(
      await mensajes({
        ...entradaBase(),
        tipoDocumento: 'guia_despacho',
        observacion: 'Llegó una caja abierta',
      }),
    ).toEqual([]);
  });

  it('E11-H2 · entrada registrada: el costo puede ser 0, pero no negativo ni con más de dos decimales', async () => {
    const conCosto = (costoUnitarioNeto: unknown) => ({
      ...entradaBase(),
      detalles: [{ formatoId: 11, cantidad: 1, costoUnitarioNeto }],
    });

    expect(await mensajes(conCosto(0))).toEqual([]);
    for (const costo of [-1, 10.123, '3500', 10_000_000_000]) {
      expect(await mensajes(conCosto(costo))).toEqual([
        'El costo unitario neto debe ser un número con hasta dos decimales desde 0 y hasta 9999999999.99.',
      ]);
    }
  });

  it('E11-H2 · entrada registrada: la cantidad es un entero mayor que 0', async () => {
    for (const cantidad of [0, -3, 1.5, '24']) {
      expect(
        await mensajes({
          ...entradaBase(),
          detalles: [{ formatoId: 11, cantidad, costoUnitarioNeto: 100 }],
        }),
      ).toEqual([
        'La cantidad recibida debe ser un número entero mayor que 0 y hasta 2147483647.',
      ]);
    }
  });

  it('E11-H2 · formato repetido: rechaza la entrada con el mismo formato dos veces', async () => {
    expect(
      await mensajes({
        ...entradaBase(),
        detalles: [
          { formatoId: 11, cantidad: 24, costoUnitarioNeto: 3500 },
          { formatoId: 11, cantidad: 2, costoUnitarioNeto: 3500 },
        ],
      }),
    ).toEqual(['Cada formato debe aparecer una sola vez en la entrada.']);
  });

  it('E11-H2 · datos faltantes: indica que falta el proveedor y el documento', async () => {
    const {
      proveedorId: _p,
      tipoDocumento: _t,
      numeroDocumento: _n,
      ...sinProveedorNiDocumento
    } = entradaBase();

    expect(await mensajes(sinProveedorNiDocumento)).toEqual([
      'El proveedor es obligatorio.',
      'El tipo de documento es obligatorio y debe ser uno de estos: factura, guia_despacho.',
      'El número de documento es obligatorio.',
    ]);
    expect(
      await mensajes({ ...entradaBase(), numeroDocumento: '   ' }),
    ).toEqual(['El número de documento es obligatorio.']);
  });

  it('E11-H2 · datos faltantes: indica que falta el costo de un formato', async () => {
    expect(
      await mensajes({
        ...entradaBase(),
        detalles: [
          { formatoId: 11, cantidad: 24, costoUnitarioNeto: 3500 },
          { formatoId: 12, cantidad: 6 },
        ],
      }),
    ).toEqual(['El costo unitario neto es obligatorio.']);
  });

  it('E11-H2 · datos faltantes: indica que faltan la fecha, la ubicación y los formatos', async () => {
    const {
      fechaRecepcion: _f,
      ubicacionId: _u,
      detalles: _d,
      ...sinFechaNiDetalle
    } = entradaBase();

    expect(await mensajes(sinFechaNiDetalle)).toEqual([
      'La fecha de recepción es obligatoria.',
      'La ubicación de destino es obligatoria.',
      'Indica los formatos recibidos.',
    ]);
    expect(await mensajes({ ...entradaBase(), detalles: [] })).toEqual([
      'Indica los formatos recibidos.',
    ]);
  });

  it('rechaza una fecha que no existe, un tipo de documento desconocido y un detalle mal formado', async () => {
    expect(
      await mensajes({ ...entradaBase(), fechaRecepcion: '2026-02-30' }),
    ).toEqual([
      'La fecha de recepción debe ser una fecha válida con el formato AAAA-MM-DD.',
    ]);
    expect(
      await mensajes({ ...entradaBase(), tipoDocumento: 'boleta' }),
    ).toEqual([
      'El tipo de documento es obligatorio y debe ser uno de estos: factura, guia_despacho.',
    ]);
    expect(await mensajes({ ...entradaBase(), detalles: [11] })).toEqual([
      'Indica el formato de cada línea de la entrada.',
      'La cantidad recibida es obligatoria.',
      'El costo unitario neto es obligatorio.',
    ]);
    for (const detalles of [null, 'x', { formatoId: 11 }]) {
      expect(await mensajes({ ...entradaBase(), detalles })).toEqual([
        'Indica los formatos recibidos.',
      ]);
    }
  });
});
