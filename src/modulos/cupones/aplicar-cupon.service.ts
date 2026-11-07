import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { precioConIva } from '../../common/dominio/montos.js';
import { ROLES, type Rol } from '../../common/dominio/roles.js';
import {
  ESTADOS_NOTIFICACION,
  ESTADOS_PEDIDO,
} from '../../common/dominio/valores.js';
import { errorDeCampo } from '../../common/errores/error-de-campo.js';
import type { Entorno } from '../../config/entorno.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ArticuloALaVenta } from '../carrito/carrito.service.js';
import { conSubcategorias } from '../marketing/segmento-campana.js';
import { calcularDescuento, type LineaCupon } from './calculo-cupon.js';

type Cliente = Prisma.TransactionClient;

export const CUPON_NO_DISPONIBLE =
  'El cupón no existe o ya no está disponible.';
export const CAMPO_CUPON = 'codigoCupon';

/** Una línea del carrito con lo que la tienda le vende hoy a ese rol (`articulosALaVenta`). */
export interface LineaParaCupon {
  articuloId: number;
  cantidad: number;
  articulo: ArticuloALaVenta;
}

export interface CuponAplicado {
  cuponId: number;
  codigo: string;
  descripcion: string | null;
  /** Lo que descuenta, en pesos con IVA. */
  descuento: number;
}

/** El código como lo guarda el panel: sin espacios y en mayúsculas. */
export const normalizarCodigo = (codigo: string): string =>
  codigo.replace(/\s+/g, '').toUpperCase();

const rechazo = (mensaje: string) =>
  errorDeCampo(BadRequestException, mensaje, CAMPO_CUPON);

const pesos = (monto: number) => `$${monto.toLocaleString('es-CL')}`;

/**
 * Si una cuenta puede usar un cupón sobre estas líneas y cuánto descuenta (SCRUM-150). Lo usan la
 * vista previa del carrito y la creación del pedido; esta, dentro de su transacción y con la fila
 * del cupón bloqueada, así dos pedidos simultáneos no pasan del máximo de usos. Un uso cuenta desde
 * que se crea el pedido y se libera si se cancela (decisión del 7 nov).
 */
@Injectable()
export class AplicarCuponService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
  ) {}

  async evaluar(
    cliente: Cliente,
    {
      codigo,
      usuarioId,
      rol,
      lineas,
      bloquear = false,
    }: {
      codigo: string;
      usuarioId: number;
      rol: Rol;
      lineas: LineaParaCupon[];
      bloquear?: boolean;
    },
  ): Promise<CuponAplicado> {
    const cupon = await cliente.cupon.findUnique({
      where: { codigo: normalizarCodigo(codigo) },
      select: {
        id: true,
        codigo: true,
        descripcion: true,
        tipoDescuento: true,
        valor: true,
        topeDescuento: true,
        alcance: true,
        compraMinima: true,
        fechaInicio: true,
        fechaFin: true,
        usosMaximos: true,
        usosPorCuenta: true,
        incluyeProfesionales: true,
        activo: true,
        campanaId: true,
        articulos: { select: { articuloId: true } },
        categorias: { select: { categoriaId: true } },
        marcas: { select: { marcaId: true } },
      },
    });
    if (!cupon?.activo) throw rechazo(CUPON_NO_DISPONIBLE);
    if (bloquear) {
      await cliente.$executeRaw`SELECT 1 FROM cupon WHERE id_cupon = ${cupon.id} FOR UPDATE`;
    }

    const ahora = new Date();
    if (cupon.fechaInicio && ahora < cupon.fechaInicio) {
      throw rechazo('El cupón aún no está vigente.');
    }
    if (cupon.fechaFin && ahora >= cupon.fechaFin) {
      throw rechazo('El cupón ya venció.');
    }
    if (rol === ROLES.PROFESIONAL && !cupon.incluyeProfesionales) {
      throw rechazo('Este cupón no aplica al precio profesional.');
    }
    // De campaña: solo las cuentas a las que se les envió el correo. Sin decir por qué a las demás
    if (cupon.campanaId !== null) {
      const recibio = await cliente.notificacion.count({
        where: {
          campanaId: cupon.campanaId,
          usuarioId,
          estadoEnvio: ESTADOS_NOTIFICACION.ENVIADA,
        },
      });
      if (recibio === 0) throw rechazo(CUPON_NO_DISPONIBLE);
    }

    const enUso = {
      cuponId: cupon.id,
      estadoActual: { not: ESTADOS_PEDIDO.CANCELADO },
    };
    const [usosTotales, usosCuenta] = await Promise.all([
      cupon.usosMaximos === null ? 0 : cliente.pedido.count({ where: enUso }),
      cupon.usosPorCuenta === null
        ? 0
        : cliente.pedido.count({ where: { ...enUso, usuarioId } }),
    ]);
    if (cupon.usosMaximos !== null && usosTotales >= cupon.usosMaximos) {
      throw rechazo('El cupón ya alcanzó su límite de usos.');
    }
    if (cupon.usosPorCuenta !== null && usosCuenta >= cupon.usosPorCuenta) {
      throw rechazo(
        cupon.usosPorCuenta === 1
          ? 'Ya usaste este cupón.'
          : `Ya usaste este cupón las ${cupon.usosPorCuenta} veces que permite.`,
      );
    }

    const categorias =
      cupon.categorias.length === 0
        ? []
        : conSubcategorias(
            cupon.categorias.map((c) => c.categoriaId),
            await cliente.categoria.findMany({
              select: { id: true, padreId: true },
            }),
          );
    const resultado = calcularDescuento(
      {
        tipoDescuento: cupon.tipoDescuento,
        valor: cupon.valor,
        topeDescuento: cupon.topeDescuento,
        alcance: cupon.alcance,
        compraMinima: cupon.compraMinima,
        articulos: cupon.articulos.map((a) => a.articuloId),
        categorias,
        marcas: cupon.marcas.map((m) => m.marcaId),
      },
      await this.lineasCupon(cliente, lineas),
    );
    if (!resultado.aplica) {
      throw rechazo(
        resultado.motivo === 'compra_minima'
          ? `Este cupón es para compras desde ${pesos(cupon.compraMinima ?? 0)}.`
          : 'El cupón no aplica a los productos de tu carrito.',
      );
    }
    return {
      cuponId: cupon.id,
      codigo: cupon.codigo,
      descripcion: cupon.descripcion,
      descuento: resultado.descuento,
    };
  }

  /** Cada línea con su precio con IVA y la categoría y marca de cada producto que la compone. */
  private async lineasCupon(
    cliente: Cliente,
    lineas: LineaParaCupon[],
  ): Promise<LineaCupon[]> {
    const porcentajeIva = this.config.get('IVA_PORCENTAJE', { infer: true });
    const formatoIds = [
      ...new Set(
        lineas.flatMap(({ articulo }) =>
          articulo.componentes.map((c) => c.formatoId),
        ),
      ),
    ];
    const formatos = await cliente.formatoProducto.findMany({
      where: { id: { in: formatoIds } },
      select: {
        id: true,
        producto: { select: { categoriaId: true, marcaId: true } },
      },
    });
    const productoDe = new Map(formatos.map((f) => [f.id, f.producto]));
    return lineas.map(({ articuloId, cantidad, articulo }) => ({
      articuloId,
      cantidad,
      precioConIva: precioConIva(articulo.neto, porcentajeIva),
      productos: articulo.componentes
        .map((c) => productoDe.get(c.formatoId))
        .filter((p): p is { categoriaId: number; marcaId: number | null } =>
          Boolean(p),
        ),
    }));
  }
}
