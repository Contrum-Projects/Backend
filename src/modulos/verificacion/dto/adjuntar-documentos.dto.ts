import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ValidateBy } from 'class-validator';
import { TIPOS_ANTECEDENTE } from '../../../common/dominio/valores.js';
import { MAXIMO_ANTECEDENTES } from '../tipo-archivo-antecedente.js';

const TIPOS: readonly string[] = Object.values(TIPOS_ANTECEDENTE);

export const MENSAJE_TIPOS = `Indica el tipo de cada documento en el campo «tipos» (${TIPOS.join(', ')}), uno por archivo y en el mismo orden.`;

/**
 * Datos de texto que acompañan a los documentos que respaldan la solicitud (`multipart/form-data`,
 * E10-H2). Los archivos van en el campo `archivos` y los recibe el interceptor, no este DTO.
 */
export class AdjuntarDocumentosDto {
  @ApiProperty({
    type: [String],
    enum: TIPOS,
    example: ['titulo', 'certificado'],
    description: `Tipo de cada documento, uno por archivo y en el mismo orden (de 1 a ${MAXIMO_ANTECEDENTES}). Se repite el campo por cada archivo.`,
  })
  // Con un solo archivo el formulario manda un texto suelto: se convierte antes de validar
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? [value] : value,
  )
  @ValidateBy({
    name: 'tiposAntecedente',
    validator: {
      validate: (valor: unknown) =>
        Array.isArray(valor) &&
        valor.length >= 1 &&
        valor.length <= MAXIMO_ANTECEDENTES &&
        valor.every(
          (tipo: unknown) => typeof tipo === 'string' && TIPOS.includes(tipo),
        ),
      defaultMessage: () => MENSAJE_TIPOS,
    },
  })
  tipos: string[];
}
