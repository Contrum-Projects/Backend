import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import { errorDeCampo } from '../../common/errores/error-de-campo.js';
import { TAMANO_MAXIMO_IMAGEN_BYTES } from '../catalogo/imagenes.service.js';
import { VERSIONES_IMAGEN } from './portada.service.js';

const Base = FileFieldsInterceptor(
  [
    { name: VERSIONES_IMAGEN.ESCRITORIO, maxCount: 1 },
    { name: VERSIONES_IMAGEN.CELULAR, maxCount: 1 },
  ],
  {
    // En memoria: los archivos van directo al almacén (RNF-20). Dos campos de texto: el destino
    limits: { fileSize: TAMANO_MAXIMO_IMAGEN_BYTES, files: 2, fields: 2 },
  },
);

/**
 * Recibe las imágenes de un slide nuevo (SCRUM-157): `escritorio` y, si viene, `celular`, de
 * hasta 4 MB cada una, junto a `tipoDestino` y `destino`. Los errores de multer, en inglés, se
 * responden en español.
 */
@Injectable()
export class SubidaPortadaInterceptor extends Base {
  async intercept(
    contexto: ExecutionContext,
    siguiente: CallHandler,
  ): Promise<Observable<unknown>> {
    try {
      return await super.intercept(contexto, siguiente);
    } catch (error) {
      if (error instanceof PayloadTooLargeException) {
        throw new PayloadTooLargeException(
          'Cada imagen puede pesar hasta 4 MB.',
        );
      }
      if (error instanceof HttpException && error.getStatus() === 400) {
        throw errorDeCampo(
          BadRequestException,
          'Adjunta una imagen en «escritorio» y, si quieres, otra en «celular», junto al destino.',
          VERSIONES_IMAGEN.ESCRITORIO,
        );
      }
      throw error;
    }
  }
}
