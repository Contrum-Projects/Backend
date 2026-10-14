/**
 * Valores permitidos de las columnas de estado y tipo que los documentos del
 * proyecto ya definen. Las columnas son VARCHAR en la base; valida contra estas
 * listas en los DTOs (`@IsIn(Object.values(...))`) y en los servicios.
 *
 * Si una lista cambia, actualízala aquí y en docs/reglas-de-negocio.md.
 * Listas que siguen abiertas (no las inventes): estados de envío, de pago y de
 * notificación; tipos de movimiento y de token; modalidades y especialidades.
 */

/** PEDIDO.estado_actual (Épica 8: ocho estados). */
export const ESTADOS_PEDIDO = {
  PENDIENTE_PAGO: 'pendiente_pago',
  PAGADO: 'pagado',
  EN_PREPARACION: 'en_preparacion',
  DESPACHADO: 'despachado',
  ENTREGADO: 'entregado',
  LISTO_PARA_RETIRO: 'listo_para_retiro',
  RETIRADO: 'retirado',
  CANCELADO: 'cancelado',
} as const;

/** PEDIDO.tipo_entrega (RF-07.01). */
export const TIPOS_ENTREGA = {
  DESPACHO: 'despacho',
  RETIRO: 'retiro',
} as const;

/** PEDIDO.tipo_documento_solicitado (RF-09.01). */
export const TIPOS_DOCUMENTO = {
  BOLETA: 'boleta',
  FACTURA: 'factura',
} as const;

/** ARTICULO_VENTA.tipo: discriminador del supertipo. */
export const TIPOS_ARTICULO = {
  FORMATO: 'formato',
  PACK: 'pack',
} as const;

/** PRODUCTO.origen_descripcion (RF-04.04, mide OE3). */
export const ORIGENES_DESCRIPCION = {
  MANUAL: 'manual',
  IA: 'ia',
  IA_EDITADA: 'ia_editada',
} as const;

/** DETALLE_PEDIDO.tipo_precio y HISTORIAL_PRECIO.tipo_precio. */
export const TIPOS_PRECIO = {
  MINORISTA: 'minorista',
  MAYORISTA: 'mayorista',
} as const;

/** SOLICITUD_VERIFICACION.estado (Épica 10; el sistema nunca rechaza solo: RNF-27). */
export const ESTADOS_SOLICITUD = {
  PENDIENTE: 'pendiente',
  REVISION_MANUAL: 'revision_manual',
  APROBADA: 'aprobada',
  RECHAZADA: 'rechazada',
} as const;

/** CAMPANA.tipo: campaña de envío único o saludo de cumpleaños. */
export const TIPOS_CAMPANA = {
  ENVIO_UNICO: 'envio_unico',
  CUMPLEANOS: 'cumpleanos',
} as const;

export type Valor<T extends Record<string, string>> = T[keyof T];
