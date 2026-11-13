/** Palabras de un nombre, sin tildes, mayúsculas ni signos: «Muñoz-Pérez» y «MUNOZ PEREZ» son iguales. */
const palabras = (texto: string): string[] =>
  texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((palabra) => palabra !== '');

/**
 * Si el nombre del contribuyente que entrega el SII es el de la cuenta (SCRUM-163): todas las
 * palabras del nombre y del apellido de la cuenta deben estar en el del SII, en cualquier orden.
 * El SII escribe a las personas como «APELLIDOS NOMBRES», y la cuenta puede tener solo un nombre o
 * un apellido. Sin nombre del SII, o con el de una empresa, no calza: la solicitud sigue por los
 * documentos y nunca se rechaza sola (RNF-27).
 */
export const nombreCalza = (
  contribuyente: string | null,
  nombre: string,
  apellido: string,
): boolean => {
  if (contribuyente === null) return false;
  const delSii = new Set(palabras(contribuyente));
  const deLaCuenta = palabras(`${nombre} ${apellido}`);
  return (
    deLaCuenta.length > 0 && deLaCuenta.every((palabra) => delSii.has(palabra))
  );
};
