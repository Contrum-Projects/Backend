import { ROLES_COMPRADOR, type Rol } from '../../common/dominio/roles.js';

/** Zona horaria de la tienda: el cumpleaños y la hora del saludo son los de Chile (E12-H5). */
const ZONA_HORARIA_TIENDA = 'America/Santiago';

/** Hora de Chile desde la que sale el saludo del día (decisión del 5 de noviembre de 2026). */
export const HORA_SALUDO_CUMPLEANOS = 9;

/** Fecha y hora de un instante en Chile. */
const partesEnLaTienda = (ahora: Date) => {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA_TIENDA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ahora);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? '';
  return {
    anio: Number(parte('year')),
    mes: parte('month'),
    dia: parte('day'),
    hora: Number(parte('hour')),
  };
};

const esBisiesto = (anio: number): boolean =>
  (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;

/** Año calendario en Chile: el saludo sale una vez en él (E12-H5, CA1). */
export const anioEnLaTienda = (ahora: Date): number =>
  partesEnLaTienda(ahora).anio;

/**
 * Instante en que empieza ese año en Chile (1 de enero a las 0:00). Calcula la diferencia con UTC
 * de ese día, así sirve con o sin horario de verano (Chile cambia de hora en horas enteras).
 */
export const inicioDelAnio = (anio: number): Date => {
  const medianocheUtc = Date.UTC(anio, 0, 1);
  const enChile = partesEnLaTienda(new Date(medianocheUtc));
  const comoUtc = Date.UTC(
    enChile.anio,
    Number(enChile.mes) - 1,
    Number(enChile.dia),
    enChile.hora,
  );
  return new Date(medianocheUtc - (comoUtc - medianocheUtc));
};

/** Ya son las 9:00 o más en Chile: antes no sale ningún saludo. */
export const esHoraDeSaludar = (ahora: Date): boolean =>
  partesEnLaTienda(ahora).hora >= HORA_SALUDO_CUMPLEANOS;

/**
 * Días de nacimiento (MM-DD) que se saludan hoy en Chile. Quien nació un 29 de febrero se saluda el
 * 28 de febrero en los años no bisiestos (decisión del 5 de noviembre de 2026).
 */
export const cumpleanosDeHoy = (ahora: Date): string[] => {
  const { anio, mes, dia } = partesEnLaTienda(ahora);
  const hoy = `${mes}-${dia}`;
  return hoy === '02-28' && !esBisiesto(anio) ? [hoy, '02-29'] : [hoy];
};

/** La fecha de nacimiento (columna `@db.Date`, medianoche UTC) cae hoy en Chile. */
export const esCumpleanosHoy = (fechaNacimiento: Date, ahora: Date): boolean =>
  cumpleanosDeHoy(ahora).includes(fechaNacimiento.toISOString().slice(5, 10));

/** Lo que la regla necesita de la cuenta. */
export interface CuentaCumpleanos {
  activo: boolean;
  rol: string;
  aceptaMarketingEmail: boolean;
  fechaVerificacionCorreo: Date | null;
  fechaNacimiento: Date | null;
}

/**
 * E12-H5 · CA1 y CA3: se saluda a una cuenta que compra en la tienda (el personal nunca recibe
 * publicidad), activa, con el correo verificado, que acepta publicidad y que tiene fecha de
 * nacimiento.
 */
export const puedeRecibirSaludo = (
  cuenta: CuentaCumpleanos,
): cuenta is CuentaCumpleanos & { fechaNacimiento: Date } =>
  cuenta.activo &&
  ROLES_COMPRADOR.includes(cuenta.rol as Rol) &&
  cuenta.aceptaMarketingEmail &&
  cuenta.fechaVerificacionCorreo !== null &&
  cuenta.fechaNacimiento !== null;
