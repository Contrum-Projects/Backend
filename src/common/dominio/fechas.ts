/** Zona horaria de la tienda: «hoy» para la fecha de recepción (E11-H2) y la vigencia de packs (E3-H6). */
const ZONA_HORARIA_TIENDA = 'America/Santiago';

/** Fecha de hoy (AAAA-MM-DD) en la zona horaria de la tienda. */
export const hoyEnLaTienda = (ahora = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA_TIENDA }).format(
    ahora,
  );

/**
 * Una fecha AAAA-MM-DD como el `Date` que Prisma usa para una columna `@db.Date` (medianoche
 * UTC). `null` sigue siendo `null` y `undefined` (no cambiar) sigue siendo `undefined`.
 */
export function aFechaSinHora(valor: string): Date;
export function aFechaSinHora(valor: string | null): Date | null;
export function aFechaSinHora(
  valor: string | null | undefined,
): Date | null | undefined;
export function aFechaSinHora(valor: string | null | undefined) {
  return typeof valor === 'string' ? new Date(`${valor}T00:00:00Z`) : valor;
}

/** Una columna `@db.Date` como AAAA-MM-DD. */
export const deFechaSinHora = (fecha: Date | null) =>
  fecha?.toISOString().slice(0, 10) ?? null;
