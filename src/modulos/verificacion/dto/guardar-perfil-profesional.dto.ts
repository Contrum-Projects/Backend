import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, ValidateBy, type ValidationArguments } from 'class-validator';
import {
  ESPECIALIDADES,
  MODALIDADES_TRABAJO,
} from '../../../common/dominio/valores.js';
import { NumeroPositivo } from '../../../common/validacion/numero-positivo.js';
import {
  recortarTexto,
  segunPresencia,
} from '../../../common/validacion/presencia.js';
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
 * Dominios de las redes sociales que se aceptan (decisión del 4 de noviembre de 2026, E10-H5):
 * Instagram, Facebook y TikTok, con o sin `www`. Sin subdominios móviles ni acortadores, que ocultan
 * el perfil final.
 */
export const DOMINIOS_RED_SOCIAL: readonly string[] = [
  'instagram.com',
  'www.instagram.com',
  'facebook.com',
  'www.facebook.com',
  'tiktok.com',
  'www.tiktok.com',
];

export const RED_SOCIAL_INVALIDA =
  'La red social debe ser el enlace a tu perfil de Instagram, Facebook o TikTok, que empiece con https://.';

/** Sin espacios, caracteres de control ni los que permiten salir de un atributo HTML. */
const CARACTERES_ENLACE = /^[^\s\p{Cc}<>"'`\\]+$/u;

/**
 * Enlace `https://` a un perfil de una red permitida. Se revisa el texto (esquema y caracteres) y,
 * además, cómo lo interpreta `URL`: el dominio debe estar en la lista exacta, sin usuario, clave ni
 * puerto (`https://instagram.com@otro.sitio` apunta a otro.sitio), y con una ruta al perfil.
 */
const esEnlaceRedSocial = (texto: string): boolean => {
  if (!texto.startsWith('https://') || !CARACTERES_ENLACE.test(texto)) {
    return false;
  }
  try {
    const url = new URL(texto);
    return (
      url.protocol === 'https:' &&
      DOMINIOS_RED_SOCIAL.includes(url.hostname) &&
      url.username === '' &&
      url.password === '' &&
      url.port === '' &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
};

/**
 * Red social opcional (decisión del 4 de noviembre de 2026, E10-H5): solo el enlace `https://` a un
 * perfil de Instagram, Facebook o TikTok. Así lo que se guarda y se muestra como enlace es siempre
 * de esas redes y no permite ejecutar código (XSS guardado). Se recorta; `null` o un texto vacío la
 * dejan sin valor. Da un solo mensaje.
 */
const RedSocial = () =>
  segunPresencia('borrable', [
    recortarTexto(true),
    ValidateBy({
      name: 'redSocial',
      validator: {
        validate: (valor: unknown) =>
          typeof valor === 'string' &&
          valor.length <= MAXIMO_RED_SOCIAL &&
          esEnlaceRedSocial(valor),
        defaultMessage: ({ value }: ValidationArguments) =>
          typeof value === 'string' && value.length > MAXIMO_RED_SOCIAL
            ? `La red social no puede superar los ${MAXIMO_RED_SOCIAL} caracteres.`
            : RED_SOCIAL_INVALIDA,
      },
    }),
  ]);

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
    example: 'https://www.instagram.com/bellavista.salon',
    maxLength: MAXIMO_RED_SOCIAL,
    nullable: true,
    description:
      'Opcional. Enlace https:// al perfil en Instagram, Facebook o TikTok (instagram.com, facebook.com o tiktok.com, con o sin www).',
  })
  @RedSocial()
  redSocial?: string | null;
}
