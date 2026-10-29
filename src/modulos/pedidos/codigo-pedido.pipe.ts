import { NotFoundException, type PipeTransform } from '@nestjs/common';

export const PEDIDO_NO_EXISTE = 'El pedido no existe.';

/**
 * Código público del pedido en la URL: 12 caracteres alfanuméricos. Cualquier otro valor no puede
 * existir, así que responde 404 con el mismo mensaje que un pedido inexistente o de otra cuenta.
 */
export class CodigoPedidoPipe implements PipeTransform<string, string> {
  transform(valor: string): string {
    if (!/^[A-Za-z0-9]{12}$/.test(valor)) {
      throw new NotFoundException(PEDIDO_NO_EXISTE);
    }
    return valor;
  }
}
