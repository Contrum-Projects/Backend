/**
 * RUT chileno. Se guarda en un formato único (E1: «RUT en formato único»):
 * cuerpo sin puntos, guion y dígito verificador en mayúscula, ej. `12345678-K`.
 */

const calcularDigitoVerificador = (cuerpo: string): string => {
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
};

/**
 * Normaliza un RUT escrito con o sin puntos y guion. Devuelve `null` si el
 * formato o el dígito verificador no son válidos.
 */
export const normalizarRut = (valor: string): string | null => {
  const limpio = valor.replace(/[.\s-]/g, '').toUpperCase();
  const coincidencia = /^(\d{7,8})([\dK])$/.exec(limpio);
  if (!coincidencia) return null;

  const cuerpo = coincidencia[1].replace(/^0+/, '');
  const digito = coincidencia[2];
  if (cuerpo.length < 7) return null;
  if (calcularDigitoVerificador(cuerpo) !== digito) return null;
  return `${cuerpo}-${digito}`;
};
