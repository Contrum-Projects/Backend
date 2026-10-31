import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ValidateBy } from 'class-validator';
import { FechaSinHora } from '../../../common/validacion/fecha-sin-hora.js';
import { MAXIMO_INT4 } from '../../../common/validacion/enteros.js';

const MENSAJE_FOLIO = 'El folio debe ser un número entero positivo.';

/**
 * Datos de texto que acompañan al PDF de la factura (`multipart/form-data`). El archivo va en el
 * campo `archivo` y lo recibe el interceptor, no este DTO.
 */
export class RegistrarFacturaDto {
  @ApiProperty({
    example: 4521,
    minimum: 1,
    description: 'Folio de la factura emitida en el SII. No puede repetirse.',
  })
  // El formulario manda texto: se convierte antes de validar
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const texto = value.trim();
    return /^\d{1,10}$/.test(texto) ? Number(texto) : texto;
  })
  @ValidateBy({
    name: 'folio',
    validator: {
      validate: (valor: unknown) =>
        Number.isInteger(valor) &&
        (valor as number) >= 1 &&
        (valor as number) <= MAXIMO_INT4,
      defaultMessage: () => MENSAJE_FOLIO,
    },
  })
  folio: number;

  @ApiPropertyOptional({
    example: '2026-10-30',
    description:
      'Fecha de emisión (AAAA-MM-DD), no futura. Si falta, se usa la de hoy en la zona horaria de la tienda.',
  })
  @FechaSinHora({ etiqueta: 'La fecha de emisión', presencia: 'puedeFaltar' })
  fechaEmision?: string;
}
