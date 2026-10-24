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
import { TAMANO_MAXIMO_IMAGEN_BYTES } from './imagenes.service.js';

/** Campo del formulario `multipart/form-data` que trae la imagen. */
export const CAMPO_IMAGEN = 'imagen';

const Base = FileInterceptor(CAMPO_IMAGEN, {
  // En memoria: el archivo va directo al almacén, nunca al disco del servidor (RNF-20)
  limits: { fileSize: TAMANO_MAXIMO_IMAGEN_BYTES, files: 1, fields: 0 },
});

/**
 * Recibe una sola imagen de hasta 5 MB en el campo `imagen` (E3-H3). Multer corta la subida
 * apenas pasa el tamaño; sus errores, en inglés, se responden en español.
 */
@Injectable()
export class SubidaImagenInterceptor extends Base {
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
    return new PayloadTooLargeException('La imagen no puede superar los 5 MB.');
  }
  if (error instanceof HttpException && error.getStatus() === 400) {
    return new BadRequestException(
      'Adjunta una sola imagen JPEG, PNG o WebP en el campo «imagen», sin otros campos.',
    );
  }
  return error;
};
