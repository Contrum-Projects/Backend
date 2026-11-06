import { BadRequestException } from '@nestjs/common';
import { aFechaSinHora } from '../../common/dominio/fechas.js';

/** Largo máximo del período, en días, contando ambos extremos (decisión del 4 nov 2026, E14-H2). */
export const MAXIMO_DIAS_REPORTE = 366;

const MS_POR_DIA = 86_400_000;

/**
 * Reglas del período de los reportes (E14-H2, E14-H1): `desde` y `hasta` en AAAA-MM-DD, ambos
 * incluidos y en hora de Chile; `hasta` no puede ser anterior a `desde` ni el período pasar de
 * 366 días. Las fechas ya llegan validadas por el DTO (`FechaSinHora`).
 */
export const validarPeriodo = (desde: string, hasta: string): void => {
  // PostgreSQL no tiene año 0: sin esto, 0000-01-01 llegaría a la consulta y respondería 500
  if (Number(desde.slice(0, 4)) < 1) {
    throw new BadRequestException('La fecha desde no es válida.');
  }
  const dias =
    (aFechaSinHora(hasta).getTime() - aFechaSinHora(desde).getTime()) /
      MS_POR_DIA +
    1;
  if (dias < 1) {
    throw new BadRequestException(
      'La fecha hasta no puede ser anterior a la fecha desde.',
    );
  }
  if (dias > MAXIMO_DIAS_REPORTE) {
    throw new BadRequestException(
      `El período no puede superar los ${MAXIMO_DIAS_REPORTE} días.`,
    );
  }
};
