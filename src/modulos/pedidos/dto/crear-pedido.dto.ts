import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsUUID,
  ValidateBy,
  type ValidationArguments,
} from 'class-validator';
import {
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
} from '../../../common/dominio/valores.js';
import { MAXIMO_INT4 } from '../../../common/validacion/enteros.js';

const ENTREGAS = Object.values(TIPOS_ENTREGA);
const DOCUMENTOS = Object.values(TIPOS_DOCUMENTO);

interface OpcionesReferencia {
  /** Campo del que depende y el valor con que este dato se exige. */
  campo: 'tipoEntrega' | 'tipoDocumento';
  valor: string;
  /** Mensaje si falta. Sin él puede faltar: lo resuelve el servicio, que conoce la cuenta. */
  faltante?: string;
  invalido: string;
  /** Mensaje cuando llega sin que corresponda. */
  sobra: string;
}

const esId = (valor: unknown) =>
  Number.isInteger(valor) &&
  (valor as number) >= 1 &&
  (valor as number) <= MAXIMO_INT4;

const estaAusente = (valor: unknown) => valor === undefined || valor === null;

/** Id que se exige con un valor de otro campo y se rechaza con los demás. */
const IdSegun = ({
  campo,
  valor: exigidoCon,
  faltante,
  invalido,
  sobra,
}: OpcionesReferencia) => {
  const exigido = (argumentos?: ValidationArguments) =>
    (argumentos?.object as CrearPedidoDto | undefined)?.[campo] === exigidoCon;
  return ValidateBy({
    name: 'idSegun',
    validator: {
      validate: (valor: unknown, argumentos?: ValidationArguments) => {
        if (!exigido(argumentos)) return valor === undefined;
        return esId(valor) || (!faltante && estaAusente(valor));
      },
      defaultMessage: (argumentos?: ValidationArguments) => {
        if (!exigido(argumentos)) return sobra;
        return faltante && estaAusente(argumentos?.value) ? faltante : invalido;
      },
    },
  });
};

/** Confirmación del carrito de la cuenta como pedido (E5-H3, RF-05.04 a RF-05.09 y RF-05.11). */
export class CrearPedidoDto {
  @ApiProperty({
    example: '0f8fad5b-d9cb-469f-a165-70867728950e',
    description:
      'UUID que el navegador genera para esta confirmación y repite si reintenta.',
  })
  @IsUUID('4', {
    message: 'La clave de idempotencia es obligatoria y debe ser un UUID.',
  })
  claveIdempotencia: string;

  @ApiProperty({ enum: ENTREGAS, example: TIPOS_ENTREGA.RETIRO })
  @IsIn(ENTREGAS, {
    message: `El tipo de entrega es obligatorio y debe ser uno de estos: ${ENTREGAS.join(', ')}.`,
  })
  tipoEntrega: string;

  @ApiPropertyOptional({
    example: 12,
    description: 'Id de una dirección de la cuenta; solo con despacho.',
  })
  @IdSegun({
    campo: 'tipoEntrega',
    valor: TIPOS_ENTREGA.DESPACHO,
    faltante: 'La dirección es obligatoria para el despacho a domicilio.',
    invalido: 'La dirección indicada no es válida.',
    sobra: 'La dirección solo se indica con despacho a domicilio.',
  })
  direccionId?: number;

  @ApiProperty({ enum: DOCUMENTOS, example: TIPOS_DOCUMENTO.BOLETA })
  @IsIn(DOCUMENTOS, {
    message: `El tipo de documento es obligatorio y debe ser uno de estos: ${DOCUMENTOS.join(', ')}.`,
  })
  tipoDocumento: string;

  @ApiPropertyOptional({
    example: 3,
    description:
      'Id de los datos de facturación de la cuenta; obligatorio con factura si la cuenta tiene datos, y solo se indica con factura.',
  })
  @IdSegun({
    campo: 'tipoDocumento',
    valor: TIPOS_DOCUMENTO.FACTURA,
    invalido: 'Los datos de facturación indicados no son válidos.',
    sobra: 'Los datos de facturación solo se indican con factura.',
  })
  datosFacturacionId?: number;
}
