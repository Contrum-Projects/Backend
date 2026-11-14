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
import { TextoOpcional } from '../../../common/validacion/texto-opcional.js';

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

/** Largo de `envio.telefono_contacto`, igual que el teléfono de la cuenta. */
export const MAXIMO_TELEFONO_CONTACTO = 20;

export const TELEFONO_SOLO_CON_DESPACHO =
  'El teléfono de contacto solo se indica con despacho a domicilio.';

/** SCRUM-167 · Un dato que solo se acepta con despacho a domicilio. */
const SoloConDespacho = () =>
  ValidateBy({
    name: 'soloConDespacho',
    validator: {
      validate: (_valor: unknown, argumentos?: ValidationArguments) =>
        (argumentos?.object as CrearPedidoDto | undefined)?.tipoEntrega ===
        TIPOS_ENTREGA.DESPACHO,
      defaultMessage: () => TELEFONO_SOLO_CON_DESPACHO,
    },
  });

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

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'LOREAL20',
    maxLength: 30,
    description:
      'Código de un cupón (SCRUM-150): se valida y se aplica al crear el pedido. Sin mayúsculas ni espacios también vale.',
  })
  @TextoOpcional({ etiqueta: 'El código del cupón', maximo: 40 })
  codigoCupon?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '+56912345678',
    maxLength: MAXIMO_TELEFONO_CONTACTO,
    description:
      'Teléfono de quien recibe el despacho (SCRUM-167); solo con despacho. Sin él se usa el de la cuenta, y si la cuenta tampoco tiene, el pedido no se crea. No cambia el teléfono de la cuenta.',
  })
  @TextoOpcional({
    etiqueta: 'El teléfono de contacto',
    maximo: MAXIMO_TELEFONO_CONTACTO,
  })
  @SoloConDespacho()
  telefonoContacto?: string | null;
}
