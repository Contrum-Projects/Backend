import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CLIENTE_IA, type ClienteIa, ErrorServicioIa } from './cliente-ia.js';
import { FirmaSugerencia } from './firma-sugerencia.js';
import {
  type ArchivoSubido,
  TAMANO_MAXIMO_IMAGEN_BYTES,
} from './imagenes.service.js';
import { detectarTipoImagen } from './tipo-imagen.js';

/** Sugerencia para que el personal la revise antes de guardarla (E4-H2). */
export interface SugerenciaDescripcion {
  descripcion: string;
  /** `null` si la foto no muestra la lista de ingredientes. */
  ingredientes: string | null;
  /** Se reenvía al guardar el producto para registrar el origen «IA» o «IA editada» (E4-H2). */
  firma: string;
}

export const MENSAJE_FOTO_ILEGIBLE =
  'No pudimos leer la foto del reverso. Prueba con otra foto o escribe la descripción a mano.';
export const MENSAJE_IA_NO_DISPONIBLE =
  'No pudimos generar la descripción en este momento. Puedes escribirla a mano.';

/**
 * Descripción de venta e ingredientes sugeridos desde la foto del reverso (E4-H1, RF-04.01 y
 * RF-04.02). No guarda nada: ni la foto ni la sugerencia. Aceptarla, editarla o descartarla, y
 * registrar su origen, es de E4-H2; escribir la descripción a mano nunca depende de esta ruta.
 */
@Injectable()
export class SugerenciaDescripcionService {
  private readonly logger = new Logger(SugerenciaDescripcionService.name);

  constructor(
    @Inject(CLIENTE_IA) private readonly ia: ClienteIa,
    private readonly firma: FirmaSugerencia,
  ) {}

  async sugerir(
    archivo: ArchivoSubido | undefined,
  ): Promise<SugerenciaDescripcion> {
    if (!archivo) {
      throw new BadRequestException(
        'Adjunta la foto del reverso (JPEG, PNG o WebP) en el campo «imagen».',
      );
    }
    if (archivo.size > TAMANO_MAXIMO_IMAGEN_BYTES) {
      throw new BadRequestException('La imagen no puede superar los 5 MB.');
    }
    const tipo = detectarTipoImagen(archivo.buffer);
    if (!tipo) {
      throw new BadRequestException('La imagen debe ser JPEG, PNG o WebP.');
    }

    const inicio = Date.now();
    let lectura: Awaited<ReturnType<ClienteIa['leerReverso']>>;
    try {
      lectura = await this.ia.leerReverso(archivo.buffer, tipo);
    } catch (error) {
      if (!(error instanceof ErrorServicioIa)) throw error;
      // Solo el motivo y la demora: nunca la imagen ni el texto generado
      this.logger.warn(
        `Sugerencia de descripción no disponible tras ${Date.now() - inicio} ms: ${error.message}`,
      );
      throw new ServiceUnavailableException(MENSAJE_IA_NO_DISPONIBLE);
    }
    const demoraMs = Date.now() - inicio;

    if (!lectura.legible) {
      this.logger.log(`Foto del reverso ilegible (${demoraMs} ms).`);
      throw new UnprocessableEntityException(MENSAJE_FOTO_ILEGIBLE);
    }
    this.logger.log(`Sugerencia de descripción generada en ${demoraMs} ms.`);
    return {
      descripcion: lectura.descripcion,
      ingredientes: lectura.ingredientes,
      firma: this.firma.firmar(lectura.descripcion),
    };
  }
}
