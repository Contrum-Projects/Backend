import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CANALES_VENTA,
  TIPOS_PRECIO,
  type Valor,
} from '../../common/dominio/valores.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  bloquearArticulo,
  bloquearPack,
  bloquearProducto,
} from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { FijarPreciosDto } from './dto/fijar-precios.dto.js';

type TipoPrecio = Valor<typeof TIPOS_PRECIO>;

/** Un precio fijado, tal como lo ve el panel. */
export interface CambioPrecio {
  id: number;
  tipoPrecio: TipoPrecio;
  precioNeto: number;
  fechaInicioVigencia: Date;
  /** `null` mientras es el precio vigente. */
  fechaFinVigencia: Date | null;
  motivo: string | null;
  fijadoPor: { nombre: string; apellido: string };
}

/** Precios vigentes de un artículo y su historial, del más reciente al más antiguo. */
export interface PreciosArticulo {
  articuloId: number;
  /** El producto o pack es exclusivo para profesionales: solo lleva precio mayorista. */
  exclusivo: boolean;
  precioMinoristaNeto: number | null;
  precioMayoristaNeto: number | null;
  historial: CambioPrecio[];
}

/** Lo que se lee del artículo para saber sus precios y si es exclusivo. */
const SELECCION_ARTICULO = {
  id: true,
  precioMinoristaNeto: true,
  precioMayoristaNeto: true,
  formato: {
    select: { productoId: true, producto: { select: { canalVenta: true } } },
  },
  pack: { select: { canalVenta: true } },
} satisfies Prisma.ArticuloVentaSelect;

type FilaArticulo = Prisma.ArticuloVentaGetPayload<{
  select: typeof SELECCION_ARTICULO;
}>;

const SELECCION_HISTORIAL = {
  id: true,
  tipoPrecio: true,
  precioNeto: true,
  fechaInicioVigencia: true,
  fechaFinVigencia: true,
  motivo: true,
  usuario: { select: { nombre: true, apellido: true } },
} satisfies Prisma.HistorialPrecioSelect;

/**
 * Precios minorista y mayorista de cada artículo de venta (E3-H5, RF-03.07 y RF-03.08). Se
 * guardan netos; el IVA se calcula al mostrarlos en la tienda. Cada cambio cierra la vigencia
 * del precio anterior y queda en HISTORIAL_PRECIO con quién lo fijó y el motivo, en la misma
 * transacción y con la fila del artículo bloqueada (RNF-12).
 */
@Injectable()
export class PreciosService {
  constructor(private readonly prisma: PrismaService) {}

  /** Precios vigentes del artículo y su historial. */
  async listar(articuloId: number): Promise<PreciosArticulo> {
    return this.preciosDe(this.prisma, articuloId);
  }

  /**
   * Aplica los precios que llegan y registra cada cambio en el historial. Un precio igual al
   * vigente no se registra; si ninguno cambia, no se escribe nada. Un artículo exclusivo para
   * profesionales no admite precio minorista.
   */
  async fijar(
    articuloId: number,
    dto: FijarPreciosDto,
    codigoPublicoUsuario: string,
  ): Promise<PreciosArticulo> {
    if (
      dto.precioMinoristaNeto === undefined &&
      dto.precioMayoristaNeto === undefined
    ) {
      throw new BadRequestException(
        'Indica el precio minorista, el mayorista o ambos.',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await bloquearArticulo(tx, articuloId);
      const { formato } = await tx.articuloVenta.findUniqueOrThrow({
        where: { id: articuloId },
        select: { formato: { select: { productoId: true } } },
      });
      // El canal se lee con su fila bloqueada: un cambio simultáneo a exclusivo no deja pasar
      // un precio minorista
      if (formato) {
        await bloquearProducto(tx, formato.productoId);
      } else {
        await bloquearPack(tx, articuloId);
      }
      const articulo = await tx.articuloVenta.findUniqueOrThrow({
        where: { id: articuloId },
        select: SELECCION_ARTICULO,
      });
      if (esExclusivo(articulo) && dto.precioMinoristaNeto !== undefined) {
        throw new BadRequestException(
          'El artículo es exclusivo para profesionales: solo lleva precio mayorista.',
        );
      }
      const usuario = await tx.usuario.findUnique({
        where: { codigoPublico: codigoPublicoUsuario },
        select: { id: true },
      });
      if (!usuario) {
        throw new UnauthorizedException('Debes iniciar sesión.');
      }

      const cambios = (
        [
          [
            TIPOS_PRECIO.MINORISTA,
            dto.precioMinoristaNeto,
            articulo.precioMinoristaNeto,
          ],
          [
            TIPOS_PRECIO.MAYORISTA,
            dto.precioMayoristaNeto,
            articulo.precioMayoristaNeto,
          ],
        ] as const
      )
        .filter(
          ([, nuevo, actual]) =>
            nuevo !== undefined &&
            (actual === null || Number(actual) !== nuevo),
        )
        .map(([tipoPrecio, nuevo]) => ({ tipoPrecio, precioNeto: nuevo! }));
      if (cambios.length === 0) {
        return this.preciosDe(tx, articuloId);
      }

      const ahora = new Date();
      for (const { tipoPrecio, precioNeto } of cambios) {
        await tx.historialPrecio.updateMany({
          where: { articuloId, tipoPrecio, fechaFinVigencia: null },
          data: { fechaFinVigencia: ahora },
        });
        await tx.historialPrecio.create({
          data: {
            articuloId,
            usuarioId: usuario.id,
            tipoPrecio,
            precioNeto,
            fechaInicioVigencia: ahora,
            motivo: dto.motivo,
          },
        });
      }
      const nuevos = Object.fromEntries(
        cambios.map(({ tipoPrecio, precioNeto }) => [
          tipoPrecio === TIPOS_PRECIO.MINORISTA
            ? 'precioMinoristaNeto'
            : 'precioMayoristaNeto',
          precioNeto,
        ]),
      );
      await tx.articuloVenta.update({
        where: { id: articuloId },
        data: nuevos,
      });
      return this.preciosDe(tx, articuloId);
    });
  }

  private async preciosDe(
    cliente: Prisma.TransactionClient | PrismaService,
    articuloId: number,
  ): Promise<PreciosArticulo> {
    const articulo = await cliente.articuloVenta.findUnique({
      where: { id: articuloId },
      select: {
        ...SELECCION_ARTICULO,
        historialPrecio: {
          select: SELECCION_HISTORIAL,
          orderBy: [{ fechaInicioVigencia: 'desc' }, { id: 'desc' }],
        },
      },
    });
    if (!articulo) {
      throw new NotFoundException('El artículo no existe.');
    }
    return {
      articuloId: articulo.id,
      exclusivo: esExclusivo(articulo),
      precioMinoristaNeto: aNumero(articulo.precioMinoristaNeto),
      precioMayoristaNeto: aNumero(articulo.precioMayoristaNeto),
      historial: articulo.historialPrecio.map((fila) => ({
        id: fila.id,
        tipoPrecio: fila.tipoPrecio as TipoPrecio,
        precioNeto: Number(fila.precioNeto),
        fechaInicioVigencia: fila.fechaInicioVigencia,
        fechaFinVigencia: fila.fechaFinVigencia,
        motivo: fila.motivo,
        fijadoPor: fila.usuario,
      })),
    };
  }
}

/** El canal es el del producto del formato, o el del pack. */
const esExclusivo = (articulo: FilaArticulo) =>
  (articulo.formato?.producto.canalVenta ?? articulo.pack?.canalVenta) ===
  CANALES_VENTA.PROFESIONAL;

const aNumero = (valor: Prisma.Decimal | null) =>
  valor === null ? null : Number(valor);
