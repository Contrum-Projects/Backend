import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Matches, ValidateIf } from 'class-validator';
import { Correo, MAXIMO_CORREO } from '../../../common/validacion/correo.js';
import { Rut } from '../../../common/validacion/rut.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';

const COMUNA = /^\d{5}$/;
const COMUNA_INVALIDA = 'La comuna no es válida.';

/**
 * Nuevos datos de facturación de la cuenta (E9-H2, RF-09.02). Con ellos el cliente pide factura
 * sin escribirlos en cada compra (E9-H1). Todos son obligatorios salvo el correo de facturación.
 */
export class CrearDatosFacturacionDto {
  @ApiProperty({
    example: '76.086.429-3',
    description: 'RUT de quien recibe la factura. Se guarda como 76086429-3.',
  })
  @Rut()
  rut: string;

  @ApiProperty({ example: 'Peluquería Los Aromos SpA', maxLength: 150 })
  @TextoObligatorio({
    etiqueta: 'La razón social',
    maximo: 150,
    femenino: true,
  })
  razonSocial: string;

  @ApiProperty({ example: 'Servicios de peluquería', maxLength: 150 })
  @TextoObligatorio({ etiqueta: 'El giro', maximo: 150 })
  giro: string;

  @ApiProperty({ example: 'Av. Providencia 1234, oficina 5', maxLength: 200 })
  @TextoObligatorio({ etiqueta: 'La dirección', maximo: 200, femenino: true })
  direccion: string;

  @ApiProperty({ example: '13123', description: 'Código CUT de la comuna.' })
  @Matches(COMUNA, { message: COMUNA_INVALIDA })
  comuna: string;

  @ApiPropertyOptional({
    example: 'facturas@losaromos.cl',
    maxLength: MAXIMO_CORREO,
    nullable: true,
    description:
      'Correo al que se enviará el documento, si es distinto al de la cuenta.',
  })
  @Correo({ presencia: 'borrable' })
  correoFacturacion?: string | null;
}

/**
 * Edición de unos datos de facturación (E9-H2): solo cambia lo que viene. `null` o un texto vacío
 * en el correo de facturación lo borra; los demás datos no se pueden borrar.
 */
export class ActualizarDatosFacturacionDto {
  @ApiPropertyOptional({ example: '76.086.429-3' })
  @Rut({ presencia: 'puedeFaltar' })
  rut?: string;

  @ApiPropertyOptional({ example: 'Peluquería Los Aromos SpA', maxLength: 150 })
  @TextoObligatorio({
    etiqueta: 'La razón social',
    maximo: 150,
    femenino: true,
    puedeFaltar: true,
  })
  razonSocial?: string;

  @ApiPropertyOptional({ example: 'Servicios de peluquería', maxLength: 150 })
  @TextoObligatorio({ etiqueta: 'El giro', maximo: 150, puedeFaltar: true })
  giro?: string;

  @ApiPropertyOptional({
    example: 'Av. Providencia 1234, oficina 5',
    maxLength: 200,
  })
  @TextoObligatorio({
    etiqueta: 'La dirección',
    maximo: 200,
    femenino: true,
    puedeFaltar: true,
  })
  direccion?: string;

  @ApiPropertyOptional({
    example: '13123',
    description: 'Código CUT de la comuna.',
  })
  @ValidateIf((_, valor) => valor !== undefined)
  @Matches(COMUNA, { message: COMUNA_INVALIDA })
  comuna?: string;

  @ApiPropertyOptional({
    example: 'facturas@losaromos.cl',
    maxLength: MAXIMO_CORREO,
    nullable: true,
  })
  @Correo({ presencia: 'borrable' })
  correoFacturacion?: string | null;
}
