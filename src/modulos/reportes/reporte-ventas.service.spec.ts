import { BadRequestException } from '@nestjs/common';
import { ESTADOS_PEDIDO, TIPOS_PRECIO } from '../../common/dominio/valores.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ReporteVentasService } from './reporte-ventas.service.js';

const CERO = { pedidos: 0, montoNeto: 0, montoIva: 0, montoTotal: 0 };

describe('ReporteVentasService', () => {
  let prisma: { $queryRaw: ReturnType<typeof vi.fn> };
  let servicio: ReporteVentasService;

  /** La consulta de la llamada n con los fragmentos anidados ya unidos: el texto con `?` y sus valores. */
  const consultaEnviada = (n: number) => {
    const [partes, ...argumentos] = prisma.$queryRaw.mock.calls[n] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const consulta = Prisma.sql(partes, ...argumentos);
    return { texto: consulta.sql, valores: consulta.values };
  };

  beforeEach(() => {
    prisma = { $queryRaw: vi.fn().mockResolvedValue([]) };
    servicio = new ReporteVentasService(prisma as unknown as PrismaService);
  });

  it('E14-H2 · ventas del período: separa pedidos y montos por tipo de cliente y suma el total', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        tipoPrecio: TIPOS_PRECIO.MINORISTA,
        pedidos: 3n,
        montoNeto: 30_000n,
        montoIva: 5_700n,
        montoTotal: 35_700n,
      },
      {
        tipoPrecio: TIPOS_PRECIO.MAYORISTA,
        pedidos: 2n,
        montoNeto: 16_000n,
        montoIva: 3_040n,
        montoTotal: 19_040n,
      },
    ]);

    const reporte = await servicio.ventasPorTipoCliente(
      '2026-11-01',
      '2026-11-30',
    );

    expect(reporte).toEqual({
      desde: '2026-11-01',
      hasta: '2026-11-30',
      minorista: {
        pedidos: 3,
        montoNeto: 30_000,
        montoIva: 5_700,
        montoTotal: 35_700,
      },
      mayorista: {
        pedidos: 2,
        montoNeto: 16_000,
        montoIva: 3_040,
        montoTotal: 19_040,
      },
      total: {
        pedidos: 5,
        montoNeto: 46_000,
        montoIva: 8_740,
        montoTotal: 54_740,
      },
    });
  });

  it('E14-H2 · ventas del período: un solo tipo con ventas deja el otro en cero', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        tipoPrecio: TIPOS_PRECIO.MAYORISTA,
        pedidos: 1n,
        montoNeto: 8_000n,
        montoIva: 1_520n,
        montoTotal: 9_520n,
      },
    ]);

    const reporte = await servicio.ventasPorTipoCliente(
      '2026-11-01',
      '2026-11-01',
    );

    expect(reporte.minorista).toEqual(CERO);
    expect(reporte.total).toEqual(reporte.mayorista);
  });

  it('E14-H2 · ventas del período: solo cuenta pedidos pagados, por fecha del pedido en hora de Chile', async () => {
    await servicio.ventasPorTipoCliente('2026-11-01', '2026-11-30');

    const { texto, valores } = consultaEnviada(0);
    expect(texto).toMatch(
      /p\.fecha_pedido >= \(\?::date\)::timestamp AT TIME ZONE 'America\/Santiago'/,
    );
    expect(texto).toMatch(
      /p\.fecha_pedido < \(\?::date \+ 1\)::timestamp AT TIME ZONE 'America\/Santiago'/,
    );
    expect(texto).toMatch(/p\.estado_actual <> ALL\(\?::text\[\]\)/);
    expect(valores).toEqual([
      '2026-11-01',
      '2026-11-30',
      [ESTADOS_PEDIDO.PENDIENTE_PAGO, ESTADOS_PEDIDO.CANCELADO],
    ]);
  });

  it('E14-H2 · período sin ventas: devuelve los totales en cero', async () => {
    const reporte = await servicio.ventasPorTipoCliente(
      '2026-11-01',
      '2026-11-30',
    );

    expect(reporte).toEqual({
      desde: '2026-11-01',
      hasta: '2026-11-30',
      minorista: CERO,
      mayorista: CERO,
      total: CERO,
    });
  });

  it('E14-H2 · período: la fecha hasta anterior a la desde responde 400 sin consultar', async () => {
    await expect(
      servicio.ventasPorTipoCliente('2026-11-30', '2026-11-01'),
    ).rejects.toThrow(
      new BadRequestException(
        'La fecha hasta no puede ser anterior a la fecha desde.',
      ),
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('E14-H2 · período: hasta 366 días se acepta; desde 367 responde 400', async () => {
    // 2028 es bisiesto: del 1 de enero al 31 de diciembre son 366 días
    await expect(
      servicio.ventasPorTipoCliente('2028-01-01', '2028-12-31'),
    ).resolves.toBeDefined();
    await expect(
      servicio.ventasPorTipoCliente('2027-01-01', '2028-01-02'),
    ).rejects.toThrow('El período no puede superar los 366 días.');
  });

  describe('exportación pedido a pedido (E14-H5, SCRUM-159)', () => {
    const PEDIDO = {
      codigoPedido: 'AB12CD34EF56',
      fecha: '2026-11-05 12:30',
      estado: ESTADOS_PEDIDO.PAGADO,
      tipoCliente: TIPOS_PRECIO.MINORISTA,
      tipoEntrega: 'despacho',
      documento: 'boleta',
      montoDescuento: 1_000,
      montoNeto: 10_000,
      montoIva: 1_900,
      montoTotal: 11_900,
    };

    it('E14-H5 · descarga del período: una fila por pedido con sus montos', async () => {
      prisma.$queryRaw.mockResolvedValue([PEDIDO]);

      const csv = await servicio.exportarVentas('2026-11-01', '2026-11-30');

      expect(csv.split('\r\n')).toEqual([
        '﻿Código pedido;Fecha;Estado;Tipo de cliente;Tipo de entrega;Documento;Descuento;Neto;IVA;Total',
        'AB12CD34EF56;2026-11-05 12:30;pagado;minorista;despacho;boleta;1000;10000;1900;11900',
        '',
      ]);
    });

    it('E14-H5 · coherente con el reporte: filtra los mismos pedidos que el reporte de ventas', async () => {
      await servicio.ventasPorTipoCliente('2026-11-01', '2026-11-30');
      await servicio.ventasPorPedido('2026-11-01', '2026-11-30');

      const reporte = consultaEnviada(0);
      const exportacion = consultaEnviada(1);
      const filtro = (texto: string) =>
        texto.slice(texto.indexOf('FROM pedido'));
      expect(filtro(exportacion.texto)).toContain(
        filtro(reporte.texto).replace(/\s*GROUP BY[\s\S]*$/, ''),
      );
      expect(exportacion.valores).toEqual(reporte.valores);
      expect(exportacion.texto).not.toMatch(/nombre|email|rut/i);
    });

    it('E14-H5 · período sin ventas: solo los encabezados', async () => {
      const csv = await servicio.exportarVentas('2026-11-01', '2026-11-30');

      expect(csv.split('\r\n')).toHaveLength(2);
    });

    it('E14-H5 · período inválido: responde 400 sin consultar', async () => {
      await expect(
        servicio.exportarVentas('2026-11-30', '2026-11-01'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
