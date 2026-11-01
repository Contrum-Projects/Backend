import { ESTADOS_PEDIDO, TIPOS_ENTREGA } from '../../common/dominio/valores.js';

type Estado = (typeof ESTADOS_PEDIDO)[keyof typeof ESTADOS_PEDIDO];

/** Nombre de cada estado tal como se lo muestra a las personas. */
export const ETIQUETAS_ESTADO: Record<Estado, string> = {
  pendiente_pago: 'pendiente de pago',
  pagado: 'pagado',
  en_preparacion: 'en preparación',
  despachado: 'despachado',
  entregado: 'entregado',
  listo_para_retiro: 'listo para retiro',
  retirado: 'retirado',
  cancelado: 'cancelado',
};

export type SentidoCambio = 'avance' | 'retroceso';

/**
 * Cambios de estado que hace el personal desde el panel (E8-H2). PROPUESTA por confirmar: la
 * historia no define la secuencia. Pasar a «pagado» es del pago (E6) y a «cancelado» de la
 * cancelación (E8-H3), por eso no hay avances desde ni hacia ellos. Desde «en preparación» el
 * siguiente estado depende de cómo se entrega el pedido.
 */
const AVANCES = {
  [ESTADOS_PEDIDO.PAGADO]: () => [ESTADOS_PEDIDO.EN_PREPARACION],
  [ESTADOS_PEDIDO.EN_PREPARACION]: (tipoEntrega: string) =>
    tipoEntrega === TIPOS_ENTREGA.RETIRO
      ? [ESTADOS_PEDIDO.LISTO_PARA_RETIRO]
      : [ESTADOS_PEDIDO.DESPACHADO],
  [ESTADOS_PEDIDO.DESPACHADO]: () => [ESTADOS_PEDIDO.ENTREGADO],
  [ESTADOS_PEDIDO.LISTO_PARA_RETIRO]: () => [ESTADOS_PEDIDO.RETIRADO],
} as const satisfies Record<string, (tipoEntrega: string) => readonly Estado[]>;

/**
 * Corrección de un error: se vuelve de a un paso, por el mismo camino. Nunca a «pendiente de
 * pago» (depende del plazo y del pago) ni desde «cancelado». PROPUESTA por confirmar.
 */
const RETROCESOS: Partial<Record<string, Estado>> = {
  [ESTADOS_PEDIDO.EN_PREPARACION]: ESTADOS_PEDIDO.PAGADO,
  [ESTADOS_PEDIDO.DESPACHADO]: ESTADOS_PEDIDO.EN_PREPARACION,
  [ESTADOS_PEDIDO.ENTREGADO]: ESTADOS_PEDIDO.DESPACHADO,
  [ESTADOS_PEDIDO.LISTO_PARA_RETIRO]: ESTADOS_PEDIDO.EN_PREPARACION,
  [ESTADOS_PEDIDO.RETIRADO]: ESTADOS_PEDIDO.LISTO_PARA_RETIRO,
};

/**
 * Estados al que se llega avanzando y por los que se avisa al cliente por correo (RF-08.03). El
 * equipo decidió el 30 de octubre de 2026 avisar solo los cambios clave, para no llenar de
 * correos: despachado, listo para retiro, entregado y retirado. «En preparación» no avisa. Volver
 * atrás nunca avisa.
 */
export const ESTADOS_CON_AVISO: readonly string[] = [
  ESTADOS_PEDIDO.DESPACHADO,
  ESTADOS_PEDIDO.LISTO_PARA_RETIRO,
  ESTADOS_PEDIDO.ENTREGADO,
  ESTADOS_PEDIDO.RETIRADO,
];

/** Asunto del correo de cada estado con aviso (página «Correos» de Figma). */
export const asuntoCambioEstado = (codigo: string, estado: string): string => {
  switch (estado) {
    case ESTADOS_PEDIDO.DESPACHADO:
      return `Tu pedido ${codigo} va en camino`;
    case ESTADOS_PEDIDO.ENTREGADO:
      return `Tu pedido ${codigo} fue entregado`;
    case ESTADOS_PEDIDO.LISTO_PARA_RETIRO:
      return `Tu pedido ${codigo} está listo para retiro`;
    case ESTADOS_PEDIDO.RETIRADO:
      return `Retiraste tu pedido ${codigo}`;
    default:
      return `Tu pedido ${codigo} cambió de estado`;
  }
};

/**
 * Si pasar de `actual` a `destino` es un cambio permitido y en qué sentido va; `null` si no lo
 * es (incluye pedir el mismo estado, saltarse pasos o un estado que no corresponde a la entrega).
 */
export const sentidoDelCambio = (
  actual: string,
  destino: string,
  tipoEntrega: string,
): SentidoCambio | null => {
  const avance = (
    AVANCES as Record<
      string,
      ((tipoEntrega: string) => readonly string[]) | undefined
    >
  )[actual];
  if (avance?.(tipoEntrega).includes(destino)) return 'avance';
  if (RETROCESOS[actual] === destino) return 'retroceso';
  return null;
};
