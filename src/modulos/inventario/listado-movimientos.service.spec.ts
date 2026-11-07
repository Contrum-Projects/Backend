import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ListadoMovimientosService } from './listado-movimientos.service.js';

const CENTRAL = { id: 1, codigo: 'A-01', bodega: { nombre: 'Central' } };
const TIENDA = { id: 2, codigo: 'G-1', bodega: { nombre: 'Tienda' } };

const fila = (extra: object) => ({
  fechaHora: new Date('2026-10-01T15:00:00Z'),
  cantidad: 3,
  observacion: null,
  formato: { id: 21, nombreFormato: '300 ml', producto: { nombre: 'Shampoo' } },
  ubicacionOrigen: null,
  ubicacionDestino: null,
  entrada: null,
  pedido: null,
  usuario: { nombre: 'Camila', apellido: 'Rojas' },
  ...extra,
});

const crear = (filas: object[]) => {
  const prisma = {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ total: BigInt(filas.length) }])
      .mockResolvedValueOnce(filas.map((_, indice) => ({ id: indice + 1 }))),
    movimientoInventario: {
      // En otro orden que la página: manda el de la consulta paginada
      findMany: vi
        .fn()
        .mockResolvedValue(
          filas.map((f, indice) => ({ id: indice + 1, ...f })).reverse(),
        ),
    },
  };
  return {
    prisma,
    servicio: new ListadoMovimientosService(prisma as unknown as PrismaService),
  };
};

describe('ListadoMovimientosService', () => {
  it('E11-H5 · movimientos: el signo sigue a la ubicación, con su referencia y quién lo registró', async () => {
    const { servicio } = crear([
      fila({
        tipo: 'entrada',
        ubicacionDestino: CENTRAL,
        entrada: { numeroDocumentoProveedor: 'F-10' },
      }),
      fila({
        tipo: 'merma_dano',
        ubicacionOrigen: CENTRAL,
        observacion: 'Envase roto',
      }),
      fila({
        tipo: 'transferencia',
        ubicacionOrigen: CENTRAL,
        ubicacionDestino: TIENDA,
      }),
      fila({
        tipo: 'venta',
        ubicacionOrigen: TIENDA,
        pedido: { codigoPublico: 'ABC123DEF456' },
      }),
      fila({
        tipo: 'reingreso',
        ubicacionDestino: TIENDA,
        pedido: { codigoPublico: 'ABC123DEF456' },
      }),
    ]);

    const { items, total } = await servicio.listar({});

    expect(total).toBe(5);
    expect(
      items.map(({ id, cantidad, referencia, registradoPor, destino }) => ({
        id,
        cantidad,
        referencia,
        registradoPor,
        destino: destino?.codigo ?? null,
      })),
    ).toEqual([
      {
        id: 1,
        cantidad: 3,
        referencia: 'F-10',
        registradoPor: { nombre: 'Camila Rojas' },
        destino: null,
      },
      {
        id: 2,
        cantidad: -3,
        referencia: 'Envase roto',
        registradoPor: { nombre: 'Camila Rojas' },
        destino: null,
      },
      {
        id: 3,
        cantidad: 3,
        referencia: null,
        registradoPor: { nombre: 'Camila Rojas' },
        destino: 'G-1',
      },
      // Ventas y reingresos los registra el sistema
      {
        id: 4,
        cantidad: -3,
        referencia: 'ABC123DEF456',
        registradoPor: null,
        destino: null,
      },
      {
        id: 5,
        cantidad: 3,
        referencia: 'ABC123DEF456',
        registradoPor: null,
        destino: null,
      },
    ]);
    expect(items[2].ubicacion).toEqual({
      id: 1,
      codigo: 'A-01',
      bodega: 'Central',
    });
  });

  it('un período con «hasta» antes de «desde» responde 400 junto al campo, sin consultar', async () => {
    const { prisma, servicio } = crear([]);

    await expect(
      servicio.listar({ desde: '2026-10-05', hasta: '2026-10-01' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
