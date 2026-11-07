/**
 * Marcadores del correo de campaña (SCRUM-150): el personal los escribe en el asunto o el cuerpo
 * y cada correo los cambia por los datos de quien lo recibe, al enviarlo. Copia en el frontend:
 * `panel/campanas/marcadores.ts`; si cambian aquí, cámbialos allá.
 */
export const MARCADORES_CAMPANA = {
  nombre: 'Nombre de quien recibe',
  apellido: 'Apellido de quien recibe',
  nombre_completo: 'Nombre y apellido de quien recibe',
  enlace_tienda: 'Enlace a la tienda',
} as const;

export type MarcadorCampana = keyof typeof MARCADORES_CAMPANA;

/** Los datos con que se completa un correo. Un suscriptor sin cuenta no tiene nombre. */
export interface DatosMarcadores {
  nombre: string | null;
  apellido: string | null;
  urlTienda: string;
}

/** `{palabra}`: letras minúsculas y guion bajo, sin espacios. */
const PATRON_MARCADOR = /\{([a-z_]+)\}/g;

const esMarcador = (clave: string): clave is MarcadorCampana =>
  Object.hasOwn(MARCADORES_CAMPANA, clave);

/** Los marcadores escritos que no existen, sin repetir y en el orden en que aparecen. */
export const marcadoresDesconocidos = (texto: string): string[] => [
  ...new Set(
    [...texto.matchAll(PATRON_MARCADOR)]
      .map(([, clave]) => clave)
      .filter((clave) => !esMarcador(clave)),
  ),
];

export const LISTA_MARCADORES = Object.keys(MARCADORES_CAMPANA)
  .map((clave) => `{${clave}}`)
  .join(', ');

const valorDe = (clave: MarcadorCampana, datos: DatosMarcadores): string => {
  switch (clave) {
    case 'nombre':
      return datos.nombre?.trim() ?? '';
    case 'apellido':
      return datos.apellido?.trim() ?? '';
    case 'nombre_completo':
      return [datos.nombre, datos.apellido]
        .map((parte) => parte?.trim() ?? '')
        .filter(Boolean)
        .join(' ');
    case 'enlace_tienda':
      return datos.urlTienda.replace(/\/+$/, '');
  }
};

/**
 * Cambia cada marcador por su dato. PROPUESTA por confirmar: un marcador sin dato (el nombre de un
 * suscriptor sin cuenta) se quita junto con la coma que lo separa, así «Hola, {nombre}:» queda
 * «Hola:». Lo que no es un marcador conocido queda tal cual (al guardar ya se rechazó).
 */
export const aplicarMarcadores = (
  texto: string,
  datos: DatosMarcadores,
): string =>
  texto
    .replace(
      /(,[ \t]*)?\{([a-z_]+)\}([ \t]*,[ \t]*)?/g,
      (
        completo,
        comaAntes: string | undefined,
        clave: string,
        comaDespues: string | undefined,
      ) => {
        if (!esMarcador(clave)) return completo;
        const valor = valorDe(clave, datos);
        if (valor) return `${comaAntes ?? ''}${valor}${comaDespues ?? ''}`;
        // Sin dato: se va con una de sus comas; si estaba entre dos, queda una
        return comaAntes && comaDespues ? ', ' : '';
      },
    )
    .replace(/[ \t]{2,}/g, ' ');
