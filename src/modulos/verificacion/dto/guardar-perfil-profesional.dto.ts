import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, ValidateBy, type ValidationArguments } from 'class-validator';
import {
  ESPECIALIDADES,
  MODALIDADES_TRABAJO,
} from '../../../common/dominio/valores.js';
import { NumeroPositivo } from '../../../common/validacion/numero-positivo.js';
import { TextoOpcional } from '../../../common/validacion/texto-opcional.js';

/** Años de experiencia que se aceptan (decisión del 4 de noviembre de 2026, E10-H5). */
export const MAXIMO_ANOS_EXPERIENCIA = 40;
/** Largos de las columnas `nombre_lugar_trabajo` y `red_social` del MER. */
export const MAXIMO_LUGAR_TRABAJO = 150;
export const MAXIMO_RED_SOCIAL = 255;

const MODALIDADES = Object.values(MODALIDADES_TRABAJO);
const LISTA_ESPECIALIDADES: readonly string[] = Object.values(ESPECIALIDADES);

export const FALTA_ESPECIALIDAD = 'Indica al menos una especialidad.';
export const ESPECIALIDAD_INVALIDA = `Alguna especialidad no es válida. Deben ser de estas: ${LISTA_ESPECIALIDADES.join(', ')}.`;
export const ESPECIALIDAD_REPETIDA =
  'Cada especialidad debe aparecer una sola vez.';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Una o más especialidades de la lista, sin repetir. Da un solo mensaje por campo. */
const Especialidades = () =>
  ValidateBy({
    name: 'especialidades',
    validator: {
      validate: (valor: unknown) =>
        Array.isArray(valor) &&
        valor.length > 0 &&
        valor.every(
          (e) => typeof e === 'string' && LISTA_ESPECIALIDADES.includes(e),
        ) &&
        new Set(valor).size === valor.length,
      defaultMessage: ({ value }: ValidationArguments) => {
        if (!Array.isArray(value) || value.length === 0) {
          return FALTA_ESPECIALIDAD;
        }
        const validas = value.every(
          (e) => typeof e === 'string' && LISTA_ESPECIALIDADES.includes(e),
        );
        return validas ? ESPECIALIDAD_REPETIDA : ESPECIALIDAD_INVALIDA;
      },
    },
  });

/**
 * Perfil profesional del peluquero verificado (E10-H5, RF-10.11). Se envía completo: reemplaza al
 * anterior, y un dato opcional que no viene queda sin valor. La comuna del perfil no se pide aquí.
 */
export class GuardarPerfilProfesionalDto {
  @ApiProperty({ example: 8, minimum: 0, maximum: MAXIMO_ANOS_EXPERIENCIA })
  @NumeroPositivo({
    etiqueta: 'La cantidad de años de experiencia',
    femenino: true,
    admiteCero: true,
    maximo: MAXIMO_ANOS_EXPERIENCIA,
  })
  anosExperiencia: number;

  @ApiProperty({
    enum: MODALIDADES,
    example: MODALIDADES_TRABAJO.ARRIENDO_SILLON,
    description: 'Una sola modalidad de trabajo.',
  })
  @Transform(recortar)
  @IsIn(MODALIDADES, {
    message: `La modalidad de trabajo es obligatoria y debe ser una de estas: ${MODALIDADES.join(', ')}.`,
  })
  modalidad: string;

  @ApiProperty({
    enum: LISTA_ESPECIALIDADES,
    isArray: true,
    example: [ESPECIALIDADES.COLORACION_TINTURAS, ESPECIALIDADES.ALISADOS],
    description: 'Al menos una especialidad, sin repetir.',
  })
  @Especialidades()
  especialidades: string[];

  @ApiPropertyOptional({
    example: 'Salón Bella Vista',
    maxLength: MAXIMO_LUGAR_TRABAJO,
    nullable: true,
    description: 'Opcional. Nombre del salón o lugar donde trabaja.',
  })
  @TextoOpcional({
    etiqueta: 'El lugar de trabajo',
    maximo: MAXIMO_LUGAR_TRABAJO,
  })
  nombreLugarTrabajo?: string | null;

  @ApiPropertyOptional({
    example: '@bellavista.salon',
    maxLength: MAXIMO_RED_SOCIAL,
    nullable: true,
    description: 'Opcional. Usuario o enlace de una red social.',
  })
  @TextoOpcional({ etiqueta: 'La red social', maximo: MAXIMO_RED_SOCIAL })
  redSocial?: string | null;
}
