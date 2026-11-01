import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import { TAMANO_MAXIMO_FACTURA_BYTES } from './tipo-archivo-factura.js';

/** Campo del formulario `multipart/form-data` que trae el PDF de la factura. */
export const CAMPO_FACTURA = 'archivo';

const Base = FileInterceptor(CAMPO_FACTURA, {
  // En memoria: el archivo va directo al almacén, nunca al disco del servidor (RNF-20)
  limits: { fileSize: TAMANO_MAXIMO_FACTURA_BYTES, files: 1, fields: 2 },
});

/**
 * Recibe un solo PDF de hasta 5 MB en el campo `archivo`, junto al folio y la fecha (E9-H3).
 * Multer corta la subida apenas pasa el tamaño; sus errores, en inglés, se responden en español.
 */
@Injectable()
export class SubidaFacturaInterceptor extends Base {
  async intercept(
    contexto: ExecutionContext,
    siguiente: CallHandler,
  ): Promise<Observable<unknown>> {
    try {
      return await super.intercept(contexto, siguiente);
    } catch (error) {
      throw traducirError(error);
    }
  }
}

const traducirError = (error: unknown) => {
  if (error instanceof PayloadTooLargeException) {
    return new PayloadTooLargeException(
      'La factura no puede superar los 5 MB.',
    );
  }
  if (error instanceof HttpException && error.getStatus() === 400) {
    return new BadRequestException(
      'Adjunta un solo PDF en el campo «archivo», con el folio y, si quieres, la fecha de emisión.',
    );
  }
  return error;
};
