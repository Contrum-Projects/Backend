import {
  Injectable,
  NotFoundException,
  type PipeTransform,
} from '@nestjs/common';
import { MAXIMO_INT4 } from '../../common/validacion/enteros.js';

/** Id del formato en la URL: un entero positivo de la columna (int4); otro valor no existe. */
@Injectable()
export class IdFormatoPipe implements PipeTransform<string, number> {
  transform(valor: string): number {
    const id = Number(valor);
    if (!/^\d{1,10}$/.test(valor) || id < 1 || id > MAXIMO_INT4) {
      throw new NotFoundException('El formato no existe.');
    }
    return id;
  }
}
