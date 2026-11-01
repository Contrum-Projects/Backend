import { StreamableFile } from '@nestjs/common';
import type { ArchivoDocumento } from './descargar-documento.service.js';

/** El PDF como descarga: con su nombre, tipo y tamaño. */
export const comoDescargaPdf = (archivo: ArchivoDocumento): StreamableFile =>
  new StreamableFile(archivo.contenido, {
    type: 'application/pdf',
    disposition: `attachment; filename="${archivo.nombre}"`,
    length: archivo.contenido.length,
  });
