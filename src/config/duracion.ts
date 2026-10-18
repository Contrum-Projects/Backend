/** Duración escrita como `<número><unidad>`: s, m, h o d (por ejemplo `15m`, `30d`). */
export const FORMATO_DURACION = /^(\d+)([smhd])$/;

const MS_POR_UNIDAD: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Convierte una duración como `15m` o `30d` a milisegundos. */
export const duracionAMs = (texto: string): number => {
  const partes = FORMATO_DURACION.exec(texto);
  if (!partes) {
    throw new Error(
      `Duración inválida: «${texto}» (usa por ejemplo 15m o 30d).`,
    );
  }
  return Number(partes[1]) * MS_POR_UNIDAD[partes[2]];
};
