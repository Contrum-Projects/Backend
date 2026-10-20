import {
  Injectable,
  NotFoundException,
  type PipeTransform,
} from '@nestjs/common';

const MAXIMO_INT4 = 2_147_483_647;

/** Id de la dirección en la URL: un entero positivo de la columna (int4); otro valor no existe. */
@Injectable()
export class IdDireccionPipe implements PipeTransform<string, number> {
  transform(valor: string): number {
    const id = Number(valor);
    if (!/^\d{1,10}$/.test(valor) || id < 1 || id > MAXIMO_INT4) {
      throw new NotFoundException('La dirección no existe.');
    }
    return id;
  }
}
