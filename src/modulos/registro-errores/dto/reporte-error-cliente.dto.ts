import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { ORIGENES_ERROR } from '../../../common/dominio/valores.js';
import { FORMATO_CODIGO_SEGUIMIENTO } from '../../../common/errores/codigo-seguimiento.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { TextoOpcional } from '../../../common/validacion/texto-opcional.js';
import {
  LARGO_COMPONENTE,
  LARGO_MENSAJE,
  LARGO_RUTA,
  LARGO_TIPO_ERROR,
  LARGO_TRAZA,
} from '../datos-error.js';

/** Solo la tienda y el panel reportan por esta ruta; los errores de la API los guarda el filtro. */
const ORIGENES_CLIENTE = [
  ORIGENES_ERROR.NAVEGADOR,
  ORIGENES_ERROR.SERVIDOR_WEB,
] as const;

/**
 * Error de una pantalla o del servidor de Next (SCRUM-168). Nunca lleva datos de formularios,
 * tokens ni la query de la URL: la ruta se guarda sin query aunque llegue con ella.
 */
export class ReporteErrorClienteDto {
  @ApiProperty({ enum: ORIGENES_CLIENTE, example: ORIGENES_ERROR.NAVEGADOR })
  @IsIn(ORIGENES_CLIENTE, {
    message: `El origen debe ser uno de estos: ${ORIGENES_CLIENTE.join(', ')}.`,
  })
  origen!: (typeof ORIGENES_CLIENTE)[number];

  @ApiProperty({
    example: 'app/(tienda)/carrito',
    maxLength: LARGO_COMPONENTE,
    description: 'Pantalla o pieza del frontend donde ocurrió.',
  })
  @TextoObligatorio({ etiqueta: 'El componente', maximo: LARGO_COMPONENTE })
  componente!: string;

  @ApiProperty({
    example: "Cannot read properties of undefined (reading 'precio')",
    maxLength: LARGO_MENSAJE,
  })
  @TextoObligatorio({ etiqueta: 'El mensaje', maximo: LARGO_MENSAJE })
  mensaje!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'TypeError',
    maxLength: LARGO_TIPO_ERROR,
  })
  @TextoOpcional({ etiqueta: 'El tipo de error', maximo: LARGO_TIPO_ERROR })
  tipoError?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '/carrito',
    maxLength: LARGO_RUTA,
  })
  @TextoOpcional({ etiqueta: 'La ruta', maximo: LARGO_RUTA })
  ruta?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: LARGO_TRAZA,
  })
  @TextoOpcional({ etiqueta: 'La traza', maximo: LARGO_TRAZA })
  traza?: string | null;

  @ApiPropertyOptional({
    description:
      'Código de una respuesta 5xx de la API, o el `digest` de Next, para unir los registros.',
    example: '3f1c2b9e-8a7d-4e0b-9a51-2c4d6e8f0a1b',
  })
  @IsOptional()
  @Matches(FORMATO_CODIGO_SEGUIMIENTO, {
    message: 'El código de seguimiento no es válido.',
  })
  codigoSeguimiento?: string;
}

export class RespuestaReporteErrorDto {
  @ApiProperty({
    description: 'Código con el que quedó el error en el registro.',
    example: '3f1c2b9e-8a7d-4e0b-9a51-2c4d6e8f0a1b',
  })
  codigoSeguimiento!: string;
}
