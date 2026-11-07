import { ROLES, type Rol } from '../../common/dominio/roles.js';
import { TIPOS_DESTINATARIO_CAMPANA } from '../../common/dominio/valores.js';

export type TipoDestinatario =
  (typeof TIPOS_DESTINATARIO_CAMPANA)[keyof typeof TIPOS_DESTINATARIO_CAMPANA];

/**
 * Segmento de una campaña (E12-H3, decisión del 5 de noviembre de 2026). Se guarda como JSON en
 * `campana.segmento`. Con categorías o marcas solo entran las cuentas que compraron algún producto
 * de una de esas categorías (con sus subcategorías) **o** de una de esas marcas.
 *
 * Filtros de cuenta (decisión del 7 nov, SCRUM-150): cada uno que se indica acota más el segmento
 * (se cumplen todos). `null`, una lista vacía o `false` es «sin ese filtro». Dentro de una lista
 * basta con una opción (una de las regiones o comunas, uno de los meses, uno de los géneros).
 */
export interface SegmentoCampana {
  tipos: TipoDestinatario[];
  categorias: number[];
  marcas: number[];
  /** Con un pedido pagado en los últimos N días. */
  compraEnUltimosDias: number | null;
  /** Compró alguna vez, pero su último pedido pagado es de hace más de N días. */
  sinComprarHaceDias: number | null;
  /** Cuántos pedidos pagados tiene (0 en el máximo: nunca compró). */
  pedidosMinimo: number | null;
  pedidosMaximo: number | null;
  /** Total con IVA de sus pedidos pagados, en pesos. */
  gastoMinimo: number | null;
  gastoMaximo: number | null;
  /** Con alguna dirección guardada en una de estas regiones o comunas. */
  regiones: number[];
  comunas: number[];
  /** Mes de su fecha de nacimiento (1 a 12). */
  mesesCumpleanos: number[];
  /** Años cumplidos hoy (hora de Chile); sin fecha de nacimiento no entra. */
  edadMinima: number | null;
  edadMaxima: number | null;
  /** El género que escribió la cuenta, tal cual. */
  generos: string[];
  /** Cuenta creada en los últimos N días. */
  registroUltimosDias: number | null;
  /** Cuenta creada hace más de N días. */
  registroHaceMasDias: number | null;
  /** Con productos en el carrito (aún sin comprar). */
  conCarrito: boolean;
}

/** Los filtros de número: `null` si no se indicó. */
export const FILTROS_NUMERO = [
  'compraEnUltimosDias',
  'sinComprarHaceDias',
  'pedidosMinimo',
  'pedidosMaximo',
  'gastoMinimo',
  'gastoMaximo',
  'edadMinima',
  'edadMaxima',
  'registroUltimosDias',
  'registroHaceMasDias',
] as const satisfies readonly (keyof SegmentoCampana)[];

/** Las listas de ids o números: sin repetidos y en orden. */
const FILTROS_LISTA = [
  'categorias',
  'marcas',
  'regiones',
  'comunas',
  'mesesCumpleanos',
] as const satisfies readonly (keyof SegmentoCampana)[];

/** Rol de las cuentas de cada tipo de destinatario; el suscriptor no tiene cuenta. */
const ROL_DE_TIPO: Partial<Record<TipoDestinatario, Rol>> = {
  [TIPOS_DESTINATARIO_CAMPANA.CLIENTE]: ROLES.CLIENTE,
  [TIPOS_DESTINATARIO_CAMPANA.PROFESIONAL]: ROLES.PROFESIONAL,
};

const unicosOrdenados = <T extends string | number>(lista: T[]): T[] =>
  [...new Set(lista)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

const numeroONulo = (valor: unknown): number | null =>
  typeof valor === 'number' && Number.isInteger(valor) ? valor : null;

const enteros = (valor: unknown): number[] =>
  Array.isArray(valor)
    ? valor.filter((id): id is number => Number.isInteger(id))
    : [];

const textos = (valor: unknown): string[] =>
  Array.isArray(valor)
    ? valor
        .filter((texto): texto is string => typeof texto === 'string')
        .map((texto) => texto.trim())
        .filter(Boolean)
    : [];

/** Mismo segmento, mismo texto: sin repetidos y en orden, así la huella de la vista previa no cambia. */
export const normalizarSegmento = (
  segmento: Partial<{
    [K in keyof SegmentoCampana]: SegmentoCampana[K] | null;
  }>,
): SegmentoCampana => ({
  tipos: unicosOrdenados(segmento.tipos ?? []),
  ...(Object.fromEntries(
    FILTROS_LISTA.map((clave) => [
      clave,
      unicosOrdenados(enteros(segmento[clave])),
    ]),
  ) as Pick<SegmentoCampana, (typeof FILTROS_LISTA)[number]>),
  ...(Object.fromEntries(
    FILTROS_NUMERO.map((clave) => [clave, numeroONulo(segmento[clave])]),
  ) as Pick<SegmentoCampana, (typeof FILTROS_NUMERO)[number]>),
  generos: unicosOrdenados(textos(segmento.generos)),
  conCarrito: segmento.conCarrito === true,
});

/**
 * El segmento como texto (lo que se guarda y lo que firma la vista previa). Los filtros sin
 * indicar no se escriben: un segmento de antes de SCRUM-150 se guarda igual que siempre.
 */
export const textoSegmento = (segmento: SegmentoCampana): string => {
  const normal = normalizarSegmento(segmento);
  const { tipos, categorias, marcas } = normal;
  const extras = Object.fromEntries(
    Object.entries(normal).filter(
      ([clave, valor]) =>
        !['tipos', 'categorias', 'marcas'].includes(clave) &&
        valor !== null &&
        valor !== false &&
        !(Array.isArray(valor) && valor.length === 0),
    ),
  );
  return JSON.stringify({ tipos, categorias, marcas, ...extras });
};

const VALORES_TIPO: readonly string[] = Object.values(
  TIPOS_DESTINATARIO_CAMPANA,
);

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
    ...(objeto as Partial<SegmentoCampana>),
    tipos,
  });
};

export const filtraPorCompras = (segmento: SegmentoCampana): boolean =>
  segmento.categorias.length > 0 || segmento.marcas.length > 0;

/**
 * Si usa algún filtro que solo tienen las cuentas (compras, ubicación, perfil, antigüedad o
 * carrito): los suscriptores sin cuenta no los tienen y no pueden entrar.
 */
export const filtraPorCuenta = (segmento: SegmentoCampana): boolean =>
  filtraPorCompras(segmento) ||
  FILTROS_NUMERO.some((clave) => segmento[clave] !== null) ||
  segmento.regiones.length > 0 ||
  segmento.comunas.length > 0 ||
  segmento.mesesCumpleanos.length > 0 ||
  segmento.generos.length > 0 ||
  segmento.conCarrito;

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
