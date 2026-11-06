/**
 * `parte` sobre `total` como porcentaje de 0 a 100, redondeado al entero (SCRUM-150). `null` si
 * `total` es 0: sin base no hay porcentaje, y 0 % diría algo que no pasó.
 */
export const porcentaje = (parte: number, total: number): number | null =>
  total > 0 ? Math.round((parte * 100) / total) : null;
