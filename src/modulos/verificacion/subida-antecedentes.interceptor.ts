import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import {
  MAXIMO_ANTECEDENTES,
  TAMANO_MAXIMO_ANTECEDENTE_BYTES,
} from './tipo-archivo-antecedente.js';
import { errorDeCampo } from '../../common/errores/error-de-campo.js';

/** Campo del formulario `multipart/form-data` que trae los documentos de la solicitud. */
export const CAMPO_ANTECEDENTES = 'archivos';

const Base = FilesInterceptor(CAMPO_ANTECEDENTES, MAXIMO_ANTECEDENTES, {
  // En memoria: los archivos van directo al almacén, nunca al disco del servidor (RNF-20)
  limits: {
    fileSize: TAMANO_MAXIMO_ANTECEDENTE_BYTES,
    files: MAXIMO_ANTECEDENTES,
    // Un campo «tipos» por archivo, y uno más de margen para que un sobrante se rechace
    fields: MAXIMO_ANTECEDENTES + 1,
  },
});

/**
 * Recibe de 1 a 5 documentos de hasta 4 MB en el campo `archivos`, junto al tipo de cada uno
 * (E10-H2). Multer corta la subida apenas pasa el tamaño; sus errores, en inglés, se responden en
 * español.
 */
@Injectable()
export class SubidaAntecedentesInterceptor extends Base {
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
    return errorDeCampo(
      PayloadTooLargeException,
      'Cada documento puede pesar hasta 4 MB.',
      'archivos',
    );
  }
  if (error instanceof HttpException && error.getStatus() === 400) {
    return errorDeCampo(
      BadRequestException,
      `Adjunta de 1 a ${MAXIMO_ANTECEDENTES} documentos en el campo «${CAMPO_ANTECEDENTES}», con el tipo de cada uno en el campo «tipos».`,
      'archivos',
    );
  }
  return error;
};
