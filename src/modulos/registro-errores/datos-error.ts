import { HttpException } from '@nestjs/common';

export const LARGO_COMPONENTE = 150;
export const LARGO_RUTA = 500;
export const LARGO_TIPO_ERROR = 100;
export const LARGO_MENSAJE = 1000;
export const LARGO_TRAZA = 4000;
const LINEAS_TRAZA = 30;

/** Mensaje de Nest para un error que no es una `HttpException`: no cambia con SCRUM-168. */
const MENSAJE_ERROR_INTERNO = 'Internal server error';

export const recortar = (texto: string, maximo: number): string =>
  texto.length > maximo ? `${texto.slice(0, maximo - 1)}…` : texto;

/** La ruta sin la query ni el fragmento: la query puede llevar tokens (`?token=`). */
export const rutaSinQuery = (url: string): string =>
  recortar(url.split(/[?#]/, 1)[0] ?? '', LARGO_RUTA);

export interface RespuestaError {
  estado: number;
  cuerpo: Record<string, unknown>;
}

const esErrorHttp = (
  error: unknown,
): error is { statusCode: number; message: string } =>
  typeof error === 'object' &&
  error !== null &&
  typeof (error as { statusCode?: unknown }).statusCode === 'number' &&
  typeof (error as { message?: unknown }).message === 'string';

/**
 * Estado y cuerpo de la respuesta, iguales a los del filtro por defecto de Nest: así el frontend
 * (`compartido/api/errores.ts`) los sigue leyendo como siempre.
 */
export const respuestaDeError = (excepcion: unknown): RespuestaError => {
  if (excepcion instanceof HttpException) {
    const estado = excepcion.getStatus();
    const respuesta = excepcion.getResponse();
    return {
      estado,
      cuerpo:
        typeof respuesta === 'string'
          ? { statusCode: estado, message: respuesta }
          : { ...respuesta },
    };
  }
  if (esErrorHttp(excepcion)) {
    return {
      estado: excepcion.statusCode,
      cuerpo: { statusCode: excepcion.statusCode, message: excepcion.message },
    };
  }
  return {
    estado: 500,
    cuerpo: { statusCode: 500, message: MENSAJE_ERROR_INTERNO },
  };
};

export interface DatosDelError {
  tipoError: string;
  mensaje: string;
  /** `Clase.metodo` del primer marco de la pila que es código propio, o `null`. */
  componente: string | null;
  traza: string | null;
}

/** Marcos que no son código de la tienda: dependencias, Node y el cliente generado de Prisma. */
const MARCO_AJENO =
  /[\\/]node_modules[\\/]|[\\/]generated[\\/]|\(node:|^at node:/;
const NOMBRE_DEL_MARCO = /^at (?:async )?([\w$.<>]+) \(/;

const lineasDeLaPila = (error: Error): string[] =>
  (error.stack ?? '')
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea.startsWith('at '));

const componenteDeLaPila = (lineas: string[]): string | null => {
  for (const linea of lineas) {
    if (MARCO_AJENO.test(linea)) continue;
    const nombre = NOMBRE_DEL_MARCO.exec(linea)?.[1];
    if (nombre && !nombre.startsWith('Object.<anonymous>')) {
      return recortar(nombre, LARGO_COMPONENTE);
    }
  }
  return null;
};

/**
 * Los errores de Prisma traen en el mensaje la llamada completa, con sus argumentos (pueden ser
 * datos personales): se guarda solo la última línea, que dice qué falló, y el código `P2xxx`.
 */
const mensajeSeguro = (error: Error): string => {
  if (!error.name.startsWith('PrismaClient')) return error.message;
  const lineas = error.message.split('\n').filter((l) => l.trim() !== '');
  const motivo = lineas.at(-1)?.trim() ?? '';
  const codigo = (error as { code?: unknown }).code;
  return typeof codigo === 'string' ? `[${codigo}] ${motivo}` : motivo;
};

/**
 * Qué pasó y dónde, para el registro (SCRUM-168). La traza lleva solo los marcos (`at …`), nunca
 * el mensaje, que en algunos errores repite los datos de la consulta.
 */
export const datosDelError = (excepcion: unknown): DatosDelError => {
  if (!(excepcion instanceof Error)) {
    return {
      tipoError: typeof excepcion,
      mensaje: 'Se lanzó un valor que no es un Error.',
      componente: null,
      traza: null,
    };
  }
  const lineas = lineasDeLaPila(excepcion);
  return {
    tipoError: recortar(excepcion.name || 'Error', LARGO_TIPO_ERROR),
    mensaje: recortar(
      mensajeSeguro(excepcion) || '(sin mensaje)',
      LARGO_MENSAJE,
    ),
    componente: componenteDeLaPila(lineas),
    traza:
      lineas.length > 0
        ? recortar(lineas.slice(0, LINEAS_TRAZA).join('\n'), LARGO_TRAZA)
        : null,
  };
};
