import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsIn,
  ValidateBy,
  ValidateNested,
  type ValidationArguments,
} from 'class-validator';
import { TIPOS_DOCUMENTO_PROVEEDOR } from '../../../common/dominio/valores.js';
import { FechaSinHora } from '../../../common/validacion/fecha-sin-hora.js';
import { IdEntero } from '../../../common/validacion/id-entero.js';
import { NumeroPositivo } from '../../../common/validacion/numero-positivo.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { TextoOpcional } from '../../../common/validacion/texto-opcional.js';

const TIPOS_DOCUMENTO = Object.values(TIPOS_DOCUMENTO_PROVEEDOR);

/** Máximo de la columna `Decimal(12, 2)` del costo unitario neto. */
export const MAXIMO_COSTO_NETO = 9_999_999_999.99;
/** Largo máximo de la observación de una entrada. */
export const MAXIMO_OBSERVACION_ENTRADA = 500;
/** Máximo de formatos por entrada: acota la transacción y los bloqueos de existencia. */
export const MAXIMO_LINEAS_ENTRADA = 200;

/** Un formato recibido en la entrada, con su cantidad y su costo. */
export class DetalleEntradaDto {
  @ApiProperty({ example: 11, description: 'Id del formato recibido.' })
  @IdEntero({
    faltante: 'Indica el formato de cada línea de la entrada.',
    invalido: 'Algún formato indicado no es válido.',
  })
  formatoId: number;

  @ApiProperty({ example: 24, minimum: 1 })
  @NumeroPositivo({ etiqueta: 'La cantidad recibida', femenino: true })
  cantidad: number;

  @ApiProperty({
    example: 3500,
    minimum: 0,
    description:
      'Costo unitario neto (sin IVA), con hasta dos decimales. Puede ser 0 (muestras sin costo).',
  })
  @NumeroPositivo({
    etiqueta: 'El costo unitario neto',
    admiteCero: true,
    decimales: true,
    maximo: MAXIMO_COSTO_NETO,
  })
  costoUnitarioNeto: number;
}

/**
 * Lista de formatos recibidos, no vacía, de hasta `MAXIMO_LINEAS_ENTRADA` y sin formatos
 * repetidos. Deja cada línea como
 * `DetalleEntradaDto` (una que no es objeto queda vacía y se informa lo que le falta) y lo que no
 * es lista como lista vacía: así cada caso da un solo mensaje en español.
 */
function ListaDetalles() {
  const comoLinea = (linea: unknown) =>
    linea instanceof DetalleEntradaDto
      ? linea
      : plainToInstance(
          DetalleEntradaDto,
          typeof linea === 'object' && linea !== null ? linea : {},
        );
  const repiteFormato = (lista: DetalleEntradaDto[]) => {
    const ids = lista
      .map((linea) => linea.formatoId)
      .filter((id) => id !== undefined);
    return new Set(ids).size !== ids.length;
  };
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      Array.isArray(value) ? value.map(comoLinea) : [],
    ),
    ValidateBy({
      name: 'listaDetalles',
      validator: {
        validate: (valor: unknown) =>
          Array.isArray(valor) &&
          valor.length > 0 &&
          valor.length <= MAXIMO_LINEAS_ENTRADA &&
          !repiteFormato(valor as DetalleEntradaDto[]),
        defaultMessage: ({ value }: ValidationArguments) => {
          if (!Array.isArray(value) || value.length === 0) {
            return 'Indica los formatos recibidos.';
          }
          return value.length > MAXIMO_LINEAS_ENTRADA
            ? `Una entrada tiene hasta ${MAXIMO_LINEAS_ENTRADA} formatos: divídela en varias.`
            : 'Cada formato debe aparecer una sola vez en la entrada.';
        },
      },
    }),
    ValidateNested({ each: true, message: 'Indica los formatos recibidos.' }),
  );
}

/**
 * Entrada de inventario recibida de un proveedor (E11-H2, RF-11.02 a RF-11.04). Todo lo recibido
 * va a una misma ubicación; cada formato aparece una sola vez.
 */
export class CrearEntradaDto {
  @ApiProperty({ example: 3, description: 'Id del proveedor (activo).' })
  @IdEntero({
    faltante: 'El proveedor es obligatorio.',
    invalido: 'El proveedor indicado no es válido.',
  })
  proveedorId: number;

  @ApiProperty({
    example: '2026-10-24',
    format: 'date',
    description: 'Fecha de recepción; no puede ser posterior a hoy.',
  })
  @FechaSinHora({
    etiqueta: 'La fecha de recepción',
    presencia: 'obligatorio',
  })
  fechaRecepcion: string;

  @ApiProperty({
    enum: TIPOS_DOCUMENTO,
    example: TIPOS_DOCUMENTO_PROVEEDOR.FACTURA,
    description: 'Documento con que el proveedor entregó la mercadería.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsIn(TIPOS_DOCUMENTO, {
    message: `El tipo de documento es obligatorio y debe ser uno de estos: ${TIPOS_DOCUMENTO.join(', ')}.`,
  })
  tipoDocumento: string;

  @ApiProperty({
    example: 'F-12345',
    maxLength: 50,
    description:
      'Se guarda sin espacios y en mayúsculas: «f-123 45» y «F-12345» son el mismo documento.',
  })
  @TextoObligatorio({ etiqueta: 'El número de documento', maximo: 50 })
  numeroDocumento: string;

  @ApiProperty({
    example: 1,
    description: 'Id de la ubicación donde queda todo lo recibido.',
  })
  @IdEntero({
    faltante: 'La ubicación de destino es obligatoria.',
    invalido: 'La ubicación indicada no es válida.',
  })
  ubicacionId: number;

  @ApiPropertyOptional({
    example: 'Llegó una caja abierta',
    maxLength: MAXIMO_OBSERVACION_ENTRADA,
    nullable: true,
  })
  @TextoOpcional({
    etiqueta: 'La observación',
    maximo: MAXIMO_OBSERVACION_ENTRADA,
  })
  observacion?: string | null;

  @ApiProperty({
    type: [DetalleEntradaDto],
    description: 'Formatos recibidos; cada uno una sola vez.',
  })
  @Type(() => DetalleEntradaDto)
  @ListaDetalles()
  detalles: DetalleEntradaDto[];
}
