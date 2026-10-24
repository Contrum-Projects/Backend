import { NotFoundException, type PipeTransform } from '@nestjs/common';
import { MAXIMO_INT4 } from './enteros.js';

/**
 * Id de la URL: un entero positivo que cabe en la columna (int4). Cualquier otro valor no puede
 * existir, así que responde 404 con el mensaje del recurso, igual que un id inexistente.
 *
 *   const idProducto = new IdRutaPipe('El producto no existe.');
 *   obtener(@Param('id', idProducto) id: number)
 */
export class IdRutaPipe implements PipeTransform<string, number> {
  constructor(private readonly noExiste: string) {}

  transform(valor: string): number {
    const id = Number(valor);
    if (!/^\d{1,10}$/.test(valor) || id < 1 || id > MAXIMO_INT4) {
      throw new NotFoundException(this.noExiste);
    }
    return id;
  }
}
