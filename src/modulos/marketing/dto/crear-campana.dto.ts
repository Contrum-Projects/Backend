import { ApiProperty } from '@nestjs/swagger';
import { ValidateBy } from 'class-validator';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { Segmento, SegmentoCampanaDto } from './segmento-campana.dto.js';

// Saltos de línea y otros caracteres de control, incluidos los separadores de línea de Unicode
// oxlint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\u0000-\u001F\u007F\u2028\u2029]');

/**
 * El asunto va en la cabecera del correo: una sola línea, sin caracteres de control (auditoría
 * del 5 de noviembre de 2026). Lo que no es texto lo deja pasar: ese mensaje lo da
 * `TextoObligatorio` (un `ValidateIf` aquí apagaría también sus reglas).
 */
export const AsuntoDeUnaLinea = () =>
  ValidateBy({
    name: 'asuntoDeUnaLinea',
    validator: {
      validate: (valor: unknown) =>
        typeof valor !== 'string' || !CONTROL.test(valor),
      defaultMessage: () =>
        'El asunto de la campaña debe ser de una sola línea.',
    },
  });

/** Largo máximo del asunto: el de la columna `campana.asunto` y `notificacion.asunto`. */
export const MAXIMO_ASUNTO_CAMPANA = 200;
/** Largo máximo del cuerpo de una campaña (texto plano). */
export const MAXIMO_CUERPO_CAMPANA = 10_000;

/** Entrada para redactar una campaña de correo (E12-H3, RF-12.05). Nace como borrador. */
export class CrearCampanaDto {
  @ApiProperty({
    example: 'Nueva línea reparadora con 20 % de descuento',
    maxLength: MAXIMO_ASUNTO_CAMPANA,
  })
  @TextoObligatorio({
    etiqueta: 'El asunto de la campaña',
    maximo: MAXIMO_ASUNTO_CAMPANA,
  })
  @AsuntoDeUnaLinea()
  asunto: string;

  @ApiProperty({
    example:
      'Hola:\n\nLlegó la nueva línea reparadora. Encuéntrala en la tienda.',
    maxLength: MAXIMO_CUERPO_CAMPANA,
    description:
      'Texto plano. Una línea en blanco separa los párrafos; el HTML se muestra tal cual, sin interpretarse.',
  })
  @TextoObligatorio({
    etiqueta: 'El cuerpo de la campaña',
    maximo: MAXIMO_CUERPO_CAMPANA,
  })
  cuerpo: string;

  @ApiProperty({ type: SegmentoCampanaDto })
  @Segmento()
  segmento: SegmentoCampanaDto;
}
