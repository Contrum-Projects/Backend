import { BadRequestException, Injectable } from '@nestjs/common';
import type { Rol } from '../../common/dominio/roles.js';
import { errorDeCampo } from '../../common/errores/error-de-campo.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CarritoService } from '../carrito/carrito.service.js';
import { AplicarCuponService, CAMPO_CUPON } from './aplicar-cupon.service.js';
import type { CuponCarritoDto } from './dto/cupon-respuesta.dto.js';

/**
 * Lo que descontaría un cupón sobre el carrito de la cuenta (SCRUM-150), antes de crear el pedido.
 * Usa las mismas reglas que el pedido, que lo vuelve a revisar al crearse: entre medio pueden
 * cambiar el carrito o los usos del cupón.
 */
@Injectable()
export class CuponCarritoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly carrito: CarritoService,
    private readonly cupones: AplicarCuponService,
  ) {}

  async validar(
    codigoPublico: string,
    rol: Rol,
    codigo: string,
  ): Promise<CuponCarritoDto> {
    const cuenta = await this.prisma.usuario.findUniqueOrThrow({
      where: { codigoPublico },
      select: {
        id: true,
        carrito: {
          select: { items: { select: { articuloId: true, cantidad: true } } },
        },
      },
    });
    const items = cuenta.carrito?.items ?? [];
    const aLaVenta = await this.carrito.articulosALaVenta(
      this.prisma,
      items.map((item) => item.articuloId),
      rol,
    );
    // Lo que ya no está a la venta no cuenta: el pedido no se podrá crear hasta quitarlo
    const lineas = items
      .filter((item) => aLaVenta.has(item.articuloId))
      .map(({ articuloId, cantidad }) => ({
        articuloId,
        cantidad,
        articulo: aLaVenta.get(articuloId)!,
      }));
    if (lineas.length === 0) {
      throw errorDeCampo(
        BadRequestException,
        'Agrega productos al carrito para usar un cupón.',
        CAMPO_CUPON,
      );
    }
    const {
      codigo: guardado,
      descripcion,
      descuento,
    } = await this.cupones.evaluar(this.prisma, {
      codigo,
      usuarioId: cuenta.id,
      rol,
      lineas,
    });
    return { codigo: guardado, descripcion, descuento };
  }
}
