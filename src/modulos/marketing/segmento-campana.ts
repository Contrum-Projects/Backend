import { ROLES, type Rol } from '../../common/dominio/roles.js';
import { TIPOS_DESTINATARIO_CAMPANA } from '../../common/dominio/valores.js';

export type TipoDestinatario =
  (typeof TIPOS_DESTINATARIO_CAMPANA)[keyof typeof TIPOS_DESTINATARIO_CAMPANA];

/**
 * Segmento de una campaña (E12-H3, decisión del 5 de noviembre de 2026). Se guarda como JSON en
 * `campana.segmento`. Con categorías o marcas solo entran las cuentas que compraron algún producto
 * de una de esas categorías (con sus subcategorías) **o** de una de esas marcas.
 */
export interface SegmentoCampana {
  tipos: TipoDestinatario[];
  categorias: number[];
  marcas: number[];
}

/** Rol de las cuentas de cada tipo de destinatario; el suscriptor no tiene cuenta. */
const ROL_DE_TIPO: Partial<Record<TipoDestinatario, Rol>> = {
  [TIPOS_DESTINATARIO_CAMPANA.CLIENTE]: ROLES.CLIENTE,
  [TIPOS_DESTINATARIO_CAMPANA.PROFESIONAL]: ROLES.PROFESIONAL,
};

const unicosOrdenados = <T extends string | number>(lista: T[]): T[] =>
  [...new Set(lista)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Mismo segmento, mismo texto: sin repetidos y en orden, así la huella de la vista previa no cambia. */
export const normalizarSegmento = (
  segmento: Partial<SegmentoCampana>,
): SegmentoCampana => ({
  tipos: unicosOrdenados(segmento.tipos ?? []),
  categorias: unicosOrdenados(segmento.categorias ?? []),
  marcas: unicosOrdenados(segmento.marcas ?? []),
});

export const textoSegmento = (segmento: SegmentoCampana): string =>
  JSON.stringify(normalizarSegmento(segmento));

const VALORES_TIPO: readonly string[] = Object.values(
  TIPOS_DESTINATARIO_CAMPANA,
);

const enteros = (valor: unknown): number[] =>
  Array.isArray(valor)
    ? valor.filter((id): id is number => Number.isInteger(id))
    : [];

/** Lee el segmento guardado. Uno ilegible o vacío no tiene destinatarios. */
export const leerSegmento = (texto: string | null): SegmentoCampana => {
  let datos: unknown = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = null;
  }
  const objeto =
    typeof datos === 'object' && datos !== null
      ? (datos as Record<string, unknown>)
      : {};
  const tipos = Array.isArray(objeto.tipos)
    ? (objeto.tipos.filter(
        (tipo) => typeof tipo === 'string' && VALORES_TIPO.includes(tipo),
      ) as TipoDestinatario[])
    : [];
  return normalizarSegmento({
    tipos,
    categorias: enteros(objeto.categorias),
    marcas: enteros(objeto.marcas),
  });
};

export const filtraPorCompras = (segmento: SegmentoCampana): boolean =>
  segmento.categorias.length > 0 || segmento.marcas.length > 0;

export const rolesDelSegmento = (segmento: SegmentoCampana): Rol[] =>
  segmento.tipos
    .map((tipo) => ROL_DE_TIPO[tipo])
    .filter((rol): rol is Rol => rol !== undefined);

export const incluyeSuscriptores = (segmento: SegmentoCampana): boolean =>
  segmento.tipos.includes(TIPOS_DESTINATARIO_CAMPANA.SUSCRIPTOR);

/** Las categorías elegidas y todas sus subcategorías, a cualquier profundidad. */
export const conSubcategorias = (
  elegidas: number[],
  todas: { id: number; padreId: number | null }[],
): number[] => {
  const hijas = new Map<number, number[]>();
  for (const { id, padreId } of todas) {
    if (padreId === null) continue;
    hijas.set(padreId, [...(hijas.get(padreId) ?? []), id]);
  }
  const resultado = new Set<number>();
  const pendientes = [...elegidas];
  while (pendientes.length > 0) {
    const id = pendientes.pop() as number;
    if (resultado.has(id)) continue;
    resultado.add(id);
    pendientes.push(...(hijas.get(id) ?? []));
  }
  return [...resultado].sort((a, b) => a - b);
};

export interface CuentaDestinataria {
  id: number;
  email: string;
}

export interface SuscriptorDestinatario {
  id: number;
  email: string;
}

export interface Destinatarios {
  cuentas: CuentaDestinataria[];
  suscriptores: SuscriptorDestinatario[];
}

/**
 * E12-H3 · CA2: llega una sola vez a cada dirección. Si una cuenta y un suscriptor sin cuenta
 * tienen el mismo correo, va a la cuenta. La dirección se compara sin mayúsculas ni espacios.
 */
export const unirDestinatarios = (
  cuentas: CuentaDestinataria[],
  suscriptores: SuscriptorDestinatario[],
): Destinatarios => {
  const vistas = new Set<string>();
  const primeraVez = (email: string): boolean => {
    const clave = email.trim().toLowerCase();
    if (vistas.has(clave)) return false;
    vistas.add(clave);
    return true;
  };
  return {
    cuentas: cuentas.filter((cuenta) => primeraVez(cuenta.email)),
    suscriptores: suscriptores.filter((lead) => primeraVez(lead.email)),
  };
};

export const totalDestinatarios = ({
  cuentas,
  suscriptores,
}: Destinatarios): number => cuentas.length + suscriptores.length;
