import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ESTADOS_PEDIDO,
  GRUPO_PEDIDOS_POR_DEFECTO,
  GRUPOS_PEDIDOS_GESTION,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
  type Valor,
} from '../../common/dominio/valores.js';
import { POR_PAGINA } from '../../common/validacion/paginacion.js';
import { escaparComodines } from '../../common/validacion/texto-busqueda.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PEDIDO_NO_EXISTE } from './codigo-pedido.pipe.js';
import type { ListarPedidosGestionDto } from './dto/listar-pedidos-gestion.dto.js';
import {
  type DetallePedidoCuenta,
  MisPedidosService,
} from './mis-pedidos.service.js';
import {
  type CambioPermitido,
  cambiosPermitidos,
} from './transiciones-estado-pedido.js';
import { GenerarOtService } from '../despacho/generar-ot.service.js';

export interface PedidoGestion {
  codigoPublico: string;
  fechaPedido: Date;
  /** Razón social si pidió factura; si no, nombre y apellido de la cuenta. */
  cliente: string;
  tipoEntrega: Valor<typeof TIPOS_ENTREGA>;
  estado: string;
  total: number;
  unidades: number;
}

export interface GrupoPedidosGestion {
  clave: string;
  nombre: string;
  /** `null`: el grupo no muestra cuántos pedidos tiene. */
  cantidad: number | null;
}

export interface ListadoPedidosGestion {
  items: PedidoGestion[];
  total: number;
  pagina: number;
  limite: number;
  grupos: GrupoPedidosGestion[];
  grupo: string;
}

export interface DetallePedidoGestion extends Omit<
  DetallePedidoCuenta,
  'historial'
> {
  cliente: { nombre: string; correo: string; telefono: string | null };
  historial: {
    estado: string;
    fecha: Date;
    comentario: string | null;
    /** «Sistema», «Cliente» o el nombre de quien lo cambió. */
    realizadoPor: string;
  }[];
  cambiosPermitidos: CambioPermitido[];
  sePuedeCancelar: boolean;
  tieneEtiqueta: boolean;
}

/** La etiqueta de la OT para descargarla (SCRUM-153). */
export interface EtiquetaOt {
  contenido: Buffer;
  tipo: string;
  extension: string;
}

/** El tipo de la etiqueta según sus primeros bytes: Chilexpress la entrega como imagen en binario. */
const TIPOS_ETIQUETA: readonly [string, string, string][] = [
  ['%PDF', 'application/pdf', 'pdf'],
  ['\x89PNG', 'image/png', 'png'],
  ['\xFF\xD8\xFF', 'image/jpeg', 'jpg'],
];

const nombreCompleto = (usuario: { nombre: string; apellido: string }) =>
  `${usuario.nombre} ${usuario.apellido}`;

/**
 * Pedidos del panel (E8-H2, SCRUM-150): la lista con su filtro por grupos y el detalle con lo que
 * solo ve el personal. Solo lectura; los cambios van por `POST /pedidos/:codigo/estado` y
 * `/cancelar`.
 */
@Injectable()
export class GestionPedidosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly misPedidos: MisPedidosService,
    private readonly ordenes: GenerarOtService,
  ) {}

  /** SCRUM-153 · La etiqueta de la OT creada por la API; 404 si el pedido no la tiene. */
  async etiqueta(codigoPedido: string): Promise<EtiquetaOt> {
    const envio = await this.prisma.envio.findFirst({
      where: { pedido: { codigoPublico: codigoPedido } },
      select: { etiqueta: true },
    });
    if (!envio?.etiqueta) {
      throw new NotFoundException(
        'El pedido no tiene una etiqueta de Chilexpress.',
      );
    }
    const contenido = Buffer.from(envio.etiqueta, 'base64');
    const inicio = contenido.subarray(0, 4).toString('latin1');
    const [, tipo, extension] = TIPOS_ETIQUETA.find(([firma]) =>
      inicio.startsWith(firma),
    ) ?? ['', 'application/octet-stream', 'bin'];
    return { contenido, tipo, extension };
  }

  /**
   * Del más reciente al más antiguo, del grupo pedido (por defecto «por preparar») y con la
   * búsqueda. Los conteos de los grupos que lo muestran usan la misma búsqueda.
   */
  async listar(
    filtros: ListarPedidosGestionDto,
  ): Promise<ListadoPedidosGestion> {
    const pagina = filtros.pagina ?? 1;
    const limite = filtros.limite ?? POR_PAGINA;
    const clave = filtros.grupo ?? GRUPO_PEDIDOS_POR_DEFECTO;
    const busqueda = this.busqueda(filtros.q);
    const delGrupo = (estados: readonly string[]): Prisma.PedidoWhereInput => ({
      AND: [
        busqueda,
        estados.length > 0 ? { estadoActual: { in: [...estados] } } : {},
      ],
    });
    const grupo = GRUPOS_PEDIDOS_GESTION.find((g) => g.clave === clave)!;
    const where = delGrupo(grupo.estados);

    const [filas, total, ...conteos] = await this.prisma.$transaction([
      this.prisma.pedido.findMany({
        where,
        select: {
          codigoPublico: true,
          fechaPedido: true,
          tipoEntrega: true,
          tipoDocumentoSolicitado: true,
          estadoActual: true,
          montoTotal: true,
          usuario: { select: { nombre: true, apellido: true } },
          datosFacturacion: { select: { razonSocial: true } },
          detalles: { select: { cantidad: true } },
        },
        orderBy: [{ fechaPedido: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * limite,
        take: limite,
      }),
      this.prisma.pedido.count({ where }),
      ...GRUPOS_PEDIDOS_GESTION.filter((g) => g.conConteo).map((g) =>
        this.prisma.pedido.count({ where: delGrupo(g.estados) }),
      ),
    ]);
    const cantidades = new Map<string, number>(
      GRUPOS_PEDIDOS_GESTION.filter((g) => g.conConteo).map((g, indice) => [
        g.clave,
        conteos[indice],
      ]),
    );

    return {
      items: filas.map((fila) => ({
        codigoPublico: fila.codigoPublico,
        fechaPedido: fila.fechaPedido,
        cliente:
          fila.tipoDocumentoSolicitado === TIPOS_DOCUMENTO.FACTURA &&
          fila.datosFacturacion
            ? fila.datosFacturacion.razonSocial
            : nombreCompleto(fila.usuario),
        tipoEntrega: fila.tipoEntrega as PedidoGestion['tipoEntrega'],
        estado: fila.estadoActual,
        total: fila.montoTotal,
        unidades: fila.detalles.reduce((suma, d) => suma + d.cantidad, 0),
      })),
      total,
      pagina,
      limite,
      grupos: GRUPOS_PEDIDOS_GESTION.map((g) => ({
        clave: g.clave,
        nombre: g.nombre,
        cantidad: cantidades.get(g.clave) ?? null,
      })),
      grupo: clave,
    };
  }

  /** Búsqueda en el código, la cuenta, la razón social o los artículos del pedido. */
  private busqueda(q: string | undefined): Prisma.PedidoWhereInput {
    if (!q) return {};
    const texto = {
      contains: escaparComodines(q),
      mode: 'insensitive' as const,
    };
    return {
      OR: [
        { codigoPublico: texto },
        { usuario: { nombre: texto } },
        { usuario: { apellido: texto } },
        { usuario: { email: texto } },
        { datosFacturacion: { razonSocial: texto } },
        {
          detalles: {
            some: {
              OR: [
                { articulo: { formato: { producto: { nombre: texto } } } },
                { articulo: { pack: { nombre: texto } } },
              ],
            },
          },
        },
      ],
    };
  }

  /**
   * El detalle del pedido como lo ve su dueño, más el cliente, el historial con comentario y
   * quién lo hizo, los cambios de estado que se pueden hacer desde aquí y si se puede cancelar.
   */
  async obtener(codigoPedido: string): Promise<DetallePedidoGestion> {
    const extra = await this.prisma.pedido.findUnique({
      where: { codigoPublico: codigoPedido },
      select: {
        usuarioId: true,
        estadoActual: true,
        tipoEntrega: true,
        envio: { select: { etiqueta: true } },
        usuario: {
          select: { nombre: true, apellido: true, email: true, telefono: true },
        },
        historial: {
          select: {
            estado: true,
            fechaHora: true,
            comentario: true,
            usuarioId: true,
            usuario: { select: { nombre: true, apellido: true } },
          },
          orderBy: { correlativo: 'asc' },
        },
      },
    });
    if (!extra) throw new NotFoundException(PEDIDO_NO_EXISTE);
    const detalle = await this.misPedidos.detalle({
      codigoPublico: codigoPedido,
    });

    return {
      ...detalle,
      cliente: {
        nombre: nombreCompleto(extra.usuario),
        correo: extra.usuario.email,
        telefono: extra.usuario.telefono,
      },
      historial: extra.historial.map((cambio) => ({
        estado: cambio.estado,
        fecha: cambio.fechaHora,
        comentario: cambio.comentario,
        realizadoPor:
          cambio.usuarioId === null || !cambio.usuario
            ? 'Sistema'
            : cambio.usuarioId === extra.usuarioId
              ? 'Cliente'
              : nombreCompleto(cambio.usuario),
      })),
      cambiosPermitidos: cambiosPermitidos(
        extra.estadoActual,
        extra.tipoEntrega,
        this.ordenes.configurado,
      ),
      tieneEtiqueta: Boolean(extra.envio?.etiqueta),
      // E8-H3: el personal cancela solo lo que aún no se paga
      sePuedeCancelar: extra.estadoActual === ESTADOS_PEDIDO.PENDIENTE_PAGO,
    };
  }
}
