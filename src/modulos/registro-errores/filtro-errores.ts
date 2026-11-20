import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { UsuarioAutenticado } from '../../autenticacion/carga-token.js';
import { ORIGENES_ERROR } from '../../common/dominio/valores.js';
import { codigoDeLaPeticion } from '../../common/errores/codigo-seguimiento.js';
import {
  datosDelError,
  respuestaDeError,
  rutaSinQuery,
} from './datos-error.js';
import { RegistroErroresService } from './registro-errores.service.js';

type PeticionRegistrable = Request & {
  id?: unknown;
  usuario?: UsuarioAutenticado;
};

/**
 * Filtro global de errores (SCRUM-168). Responde igual que el de Nest y, si el error es 5xx o no
 * controlado:
 * - lo escribe en el log con qué pasó, dónde (componente, método y ruta) y su código;
 * - lo guarda en `registro_error`, después de responder, para no demorar a la persona;
 * - agrega `codigoSeguimiento` al cuerpo, para que la persona lo informe.
 *
 * Los 4xx son respuestas esperadas (validación, permisos, no encontrado): no se registran
 * (criterio 2).
 */
@Catch()
export class FiltroErrores implements ExceptionFilter {
  private readonly logger = new Logger('RegistroErrores');

  constructor(private readonly registro: RegistroErroresService) {}

  catch(excepcion: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw excepcion;
    const http = host.switchToHttp();
    const peticion = http.getRequest<PeticionRegistrable>();
    const respuesta = http.getResponse<Response>();
    const { estado, cuerpo } = respuestaDeError(excepcion);

    if (estado < 500) {
      this.responder(respuesta, estado, cuerpo);
      return;
    }

    const codigoSeguimiento = codigoDeLaPeticion(peticion);
    const { tipoError, mensaje, componente, traza } = datosDelError(excepcion);
    const ruta = rutaSinQuery(peticion.originalUrl ?? peticion.url ?? '');
    const dondeFallo = componente ?? `${peticion.method} ${ruta}`;

    this.logger.error(
      {
        codigoSeguimiento,
        componente: dondeFallo,
        metodo: peticion.method,
        ruta,
        estadoHttp: estado,
        tipoError,
        traza,
      },
      `${tipoError} en ${dondeFallo}: ${mensaje}`,
    );
    this.responder(respuesta, estado, { ...cuerpo, codigoSeguimiento });
    void this.registro.guardar({
      codigoSeguimiento,
      origen: ORIGENES_ERROR.API,
      componente: dondeFallo,
      metodo: peticion.method,
      ruta,
      estadoHttp: estado,
      tipoError,
      mensaje,
      traza,
      usuario: peticion.usuario?.codigoPublico ?? null,
    });
  }

  private responder(
    respuesta: Response,
    estado: number,
    cuerpo: Record<string, unknown>,
  ): void {
    // Una descarga que falla a mitad (CSV, PDF) ya envió sus cabeceras: solo se cierra
    if (respuesta.headersSent) {
      respuesta.end();
      return;
    }
    respuesta.status(estado).json(cuerpo);
  }
}
