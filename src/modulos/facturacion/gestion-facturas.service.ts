import { Injectable, NotFoundException } from '@nestjs/common';
import { deFechaSinHora } from '../../common/dominio/fechas.js';
import {
  ESTADOS_FACTURA_GESTION,
  ESTADOS_SIN_VENTA,
  TIPOS_DOCUMENTO,
  type Valor,
} from '../../common/dominio/valores.js';
import {
  type Paginacion,
  POR_PAGINA,
} from '../../common/validacion/paginacion.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PEDIDO_NO_EXISTE } from '../pedidos/codigo-pedido.pipe.js';
import { FACTURA_CON_ARCHIVO } from './documento-pedido.js';

type EstadoFactura = Valor<typeof ESTADOS_FACTURA_GESTION>;

export interface FacturaGestion {
  codigoPedido: string;
  razonSocial: string;
  rut: string;
  total: number;
  estado: EstadoFactura;
  /** `null` mientras está por emitir. */
  folio: number | null;
}

export interface ListadoFacturasGestion {
  items: FacturaGestion[];
  /** Cuántas quedan por emitir, para la pestaña. */
  porEmitir: number;
  total: number;
  pagina: number;
  limite: number;
}

export interface DetalleFacturaGestion {
  codigoPedido: string;
  estado: EstadoFactura;
  receptor: {
    razonSocial: string;
    rut: string;
    giro: string;
    direccion: string;
    comuna: string;
  };
  montos: { neto: number; iva: number; total: number };
  porcentajeIva: number;
  folio: number | null;
  /** AAAA-MM-DD; `null` mientras está por emitir. */
  fechaEmision: string | null;
}

/** Pedidos que pidieron factura y son venta (ya pagados, no cancelados). */
const CON_FACTURA = {
  tipoDocumentoSolicitado: TIPOS_DOCUMENTO.FACTURA,
  estadoActual: { notIn: [...ESTADOS_SIN_VENTA] },
} satisfies Prisma.PedidoWhereInput;

/**
 * Facturas del panel (E9-H3, SCRUM-150): los pedidos pagados que pidieron factura, para emitirla
 * en el SII y registrarla. Está «emitida» cuando tiene la factura vigente con su PDF, la misma
 * regla del detalle del pedido y de la descarga.
 */
@Injectable()
export class GestionFacturasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Primero las por emitir, del pedido más antiguo al más nuevo (lo urgente arriba); después las
   * emitidas, de la emisión más reciente a la más antigua (decisión del 6 nov 2026).
   */
  async listar(paginacion: Paginacion): Promise<ListadoFacturasGestion> {
    const pagina = paginacion.pagina ?? 1;
    const limite = paginacion.limite ?? POR_PAGINA;
    const filas = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT p.id_pedido AS id
      FROM pedido p
      LEFT JOIN LATERAL (
        SELECT d.fecha_emision FROM documento_tributario d
        WHERE d.id_pedido = p.id_pedido
          AND d.tipo = ${TIPOS_DOCUMENTO.FACTURA}
          AND d.id_documento_anulador IS NULL
          AND d.ubicacion_archivo IS NOT NULL
        ORDER BY d.id_documento DESC
        LIMIT 1
      ) f ON true
      WHERE p.tipo_documento_solicitado = ${TIPOS_DOCUMENTO.FACTURA}
        AND p.estado_actual <> ALL(${ESTADOS_SIN_VENTA}::text[])
      ORDER BY (f.fecha_emision IS NOT NULL),
               CASE WHEN f.fecha_emision IS NULL THEN p.fecha_pedido END ASC,
               f.fecha_emision DESC,
               p.fecha_pedido DESC,
               p.id_pedido DESC
      LIMIT ${limite} OFFSET ${(pagina - 1) * limite}`;
    const ids = filas.map((fila) => fila.id);

    const [pedidos, total, porEmitir] = await this.prisma.$transaction([
      this.prisma.pedido.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          codigoPublico: true,
          montoTotal: true,
          datosFacturacion: { select: { razonSocial: true, rut: true } },
          documentos: {
            where: FACTURA_CON_ARCHIVO,
            select: {
              folio: true,
              razonSocialReceptor: true,
              rutReceptor: true,
            },
            orderBy: { id: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.pedido.count({ where: CON_FACTURA }),
      this.prisma.pedido.count({
        where: { ...CON_FACTURA, documentos: { none: FACTURA_CON_ARCHIVO } },
      }),
    ]);
    const porId = new Map(pedidos.map((pedido) => [pedido.id, pedido]));

    return {
      items: ids.flatMap((id) => {
        const pedido = porId.get(id);
        if (!pedido) return [];
        const [factura] = pedido.documentos;
        return [
          {
            codigoPedido: pedido.codigoPublico,
            // Emitida, lo que copió la factura; si no, los datos de facturación del pedido
            razonSocial:
              factura?.razonSocialReceptor ??
              pedido.datosFacturacion?.razonSocial ??
              '',
            rut: factura?.rutReceptor ?? pedido.datosFacturacion?.rut ?? '',
            total: pedido.montoTotal,
            estado: factura
              ? ESTADOS_FACTURA_GESTION.EMITIDA
              : ESTADOS_FACTURA_GESTION.POR_EMITIR,
            folio: factura?.folio ?? null,
          },
        ];
      }),
      porEmitir,
      total,
      pagina,
      limite,
    };
  }

  /**
   * Los datos para emitir la factura en el SII: por emitir, el receptor de los datos de
   * facturación del pedido; emitida, los que copió el documento. Un pedido que no pidió factura o
   * que aún no es venta responde 404, como uno que no existe.
   */
  async obtener(codigoPedido: string): Promise<DetalleFacturaGestion> {
    const pedido = await this.prisma.pedido.findFirst({
      where: { codigoPublico: codigoPedido, ...CON_FACTURA },
      select: {
        codigoPublico: true,
        porcentajeIva: true,
        montoNeto: true,
        montoIva: true,
        montoTotal: true,
        datosFacturacion: {
          select: {
            razonSocial: true,
            rut: true,
            giro: true,
            direccion: true,
            comuna: { select: { nombre: true } },
          },
        },
        documentos: {
          where: FACTURA_CON_ARCHIVO,
          select: {
            folio: true,
            fechaEmision: true,
            montoNeto: true,
            montoIva: true,
            montoTotal: true,
            razonSocialReceptor: true,
            rutReceptor: true,
            giroReceptor: true,
            direccionReceptor: true,
            comunaReceptor: true,
          },
          orderBy: { id: 'desc' },
          take: 1,
        },
      },
    });
    if (!pedido) throw new NotFoundException(PEDIDO_NO_EXISTE);
    const [factura] = pedido.documentos;
    const datos = pedido.datosFacturacion;

    return {
      codigoPedido: pedido.codigoPublico,
      estado: factura
        ? ESTADOS_FACTURA_GESTION.EMITIDA
        : ESTADOS_FACTURA_GESTION.POR_EMITIR,
      receptor: {
        razonSocial: factura?.razonSocialReceptor ?? datos?.razonSocial ?? '',
        rut: factura?.rutReceptor ?? datos?.rut ?? '',
        giro: factura?.giroReceptor ?? datos?.giro ?? '',
        direccion: factura?.direccionReceptor ?? datos?.direccion ?? '',
        comuna: factura?.comunaReceptor ?? datos?.comuna.nombre ?? '',
      },
      montos: factura
        ? {
            neto: factura.montoNeto,
            iva: factura.montoIva,
            total: factura.montoTotal,
          }
        : {
            neto: pedido.montoNeto,
            iva: pedido.montoIva,
            total: pedido.montoTotal,
          },
      porcentajeIva: Number(pedido.porcentajeIva),
      folio: factura?.folio ?? null,
      fechaEmision: deFechaSinHora(factura?.fechaEmision ?? null),
    };
  }
}
