import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsObject, ValidateIf, ValidateNested } from 'class-validator';
import { Booleano } from '../../../common/validacion/booleano.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { MAXIMO_TEXTO_OFERTA } from '../saludo-cumpleanos.js';
import {
  AsuntoDeUnaLinea,
  MAXIMO_ASUNTO_CAMPANA,
  MAXIMO_CUERPO_CAMPANA,
} from './crear-campana.dto.js';

/** La oferta del saludo (E12-H5, RF-12.11): texto libre; el backend no aplica descuentos. */
export class OfertaCumpleanosDto {
  @ApiProperty({
    example: true,
    description: 'Incluir la oferta en el saludo.',
  })
  @Booleano({ etiqueta: 'Activar la oferta', presencia: 'obligatorio' })
  activa: boolean;

  @ApiPropertyOptional({
    example:
      '20 % de descuento en toda la tienda durante tu semana de cumpleaños.',
    maxLength: MAXIMO_TEXTO_OFERTA,
    nullable: true,
    description:
      'Texto plano de la oferta. Obligatorio si está activa; si no, se guarda para activarla después.',
  })
  // Inactiva puede faltar; si llega, o si está activa, debe ser un texto válido
  @ValidateIf(
    (oferta: OfertaCumpleanosDto, valor) =>
      oferta.activa === true || (valor !== undefined && valor !== null),
  )
  @TextoObligatorio({
    etiqueta: 'El texto de la oferta',
    maximo: MAXIMO_TEXTO_OFERTA,
  })
  texto?: string | null;
}

/** Configuración del saludo de cumpleaños (E12-H5, RF-12.10 y RF-12.11). */
export class ConfigurarCumpleanosDto {
  @ApiProperty({
    example: '¡Feliz cumpleaños de parte de Cabello Perfecto!',
    maxLength: MAXIMO_ASUNTO_CAMPANA,
  })
  @TextoObligatorio({
    etiqueta: 'El asunto del saludo',
    maximo: MAXIMO_ASUNTO_CAMPANA,
  })
  @AsuntoDeUnaLinea()
  asunto: string;

  @ApiProperty({
    example: 'En Cabello Perfecto queremos desearte un muy feliz cumpleaños.',
    maxLength: MAXIMO_CUERPO_CAMPANA,
    description:
      'Texto plano. Una línea en blanco separa los párrafos; el HTML se muestra tal cual, sin interpretarse. El correo antepone «Hola, {nombre}:».',
  })
  @TextoObligatorio({
    etiqueta: 'El saludo',
    maximo: MAXIMO_CUERPO_CAMPANA,
  })
  cuerpo: string;

  @ApiProperty({ type: OfertaCumpleanosDto })
  @Type(() => OfertaCumpleanosDto)
  @IsObject({ message: 'Indica si el saludo lleva oferta.' })
  @ValidateNested({ message: 'Indica si el saludo lleva oferta.' })
  oferta: OfertaCumpleanosDto;
}
