/**
 * Valores permitidos de las columnas de estado y tipo que los documentos del
 * proyecto ya definen. Las columnas son VARCHAR en la base; valida contra estas
 * listas en los DTOs (`@IsIn(Object.values(...))`) y en los servicios.
 *
 * Si una lista cambia, actualízala aquí y en docs/reglas-de-negocio.md.
 * Listas que siguen abiertas (no las inventes): estados de envío (solo el
 * provisional de E5-H3); modalidades y especialidades. Los tipos de token y de
 * notificación crecen con cada historia que los necesita.
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

/**
 * PAGO.estado (E6-H1, decisión del 30 de octubre de 2026). Cada intento que Mercado Pago crea es
 * un pago: `pending` e `in_process` quedan pendientes; `rejected` y `cancelled`, rechazados. Un
 * pedido tiene a lo más un pago aprobado.
 */
export const ESTADOS_PAGO = {
  APROBADO: 'aprobado',
  RECHAZADO: 'rechazado',
  PENDIENTE: 'pendiente',
} as const;

/**
 * EVENTO_PAGO.estado_procesamiento (E6-H2, decisión del 31 de octubre de 2026). `descartado`: lo
 * pago que no es de esta tienda o de un pedido inexistente. `revision_manual` (E6-H3): lo revisa
 * una persona, porque agotó los reintentos o porque hay un pago aprobado que no se pudo aplicar
 * (otro monto, pedido cancelado o ya pagado).
 */
export const ESTADOS_EVENTO_PAGO = {
  PENDIENTE: 'pendiente',
  PROCESADO: 'procesado',
  DESCARTADO: 'descartado',
  REVISION_MANUAL: 'revision_manual',
} as const;

/** PEDIDO.tipo_entrega (RF-07.01). */
export const TIPOS_ENTREGA = {
  DESPACHO: 'despacho',
  RETIRO: 'retiro',
} as const;

/**
 * ENVIO.estado_envio (E5-H3, decisión del 30 de octubre de 2026): valor provisional de un despacho
 * recién creado. La lista la completan E7-H2 y E7-H3.
 */
export const ESTADOS_ENVIO = {
  PENDIENTE: 'pendiente',
} as const;

/**
 * ENVIO.servicio_envio (E5-H3, decisión del 30 de octubre de 2026): valor provisional hasta que
 * E7-H2 cotice con el courier.
 */
export const SERVICIOS_ENVIO = {
  POR_COTIZAR: 'por_cotizar',
} as const;

/** PEDIDO.tipo_documento_solicitado (RF-09.01). */
export const TIPOS_DOCUMENTO = {
  BOLETA: 'boleta',
  FACTURA: 'factura',
} as const;

/**
 * DOCUMENTO_TRIBUTARIO.estado (E9-H3, confirmado por el equipo el 31 de octubre de 2026): el MER
 * no define los valores. Por ahora solo `emitido`, el documento registrado y vigente; el equipo
 * podría fijar más después.
 */
export const ESTADOS_DOCUMENTO = {
  EMITIDO: 'emitido',
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

/**
 * PRODUCTO.canal_venta (E3-H1, decisión del equipo del 22 de octubre de 2026): marca si el
 * producto es de venta general o para un perfil profesional.
 */
export const CANALES_VENTA = {
  GENERAL: 'general',
  PROFESIONAL: 'profesional',
} as const;

/**
 * FORMATO_PRODUCTO.unidad_medida (E3-H2, decisión del equipo del 24 de octubre de 2026): unidad
 * del contenido del formato.
 */
export const UNIDADES_MEDIDA = {
  ML: 'ml',
  G: 'g',
  UNIDADES: 'unidades',
} as const;

/** DETALLE_PEDIDO.tipo_precio y HISTORIAL_PRECIO.tipo_precio. */
export const TIPOS_PRECIO = {
  MINORISTA: 'minorista',
  MAYORISTA: 'mayorista',
} as const;

/**
 * ENTRADA_INVENTARIO.tipo_documento_proveedor (E11-H2, decisión del 25 de octubre de 2026): el
 * documento con que el proveedor entregó la mercadería. Solo se registra como respaldo.
 */
export const TIPOS_DOCUMENTO_PROVEEDOR = {
  FACTURA: 'factura',
  GUIA_DESPACHO: 'guia_despacho',
} as const;

/**
 * MOVIMIENTO_INVENTARIO.tipo: entradas, salidas, ajustes, transferencias, venta y reingreso
 * (E11-H2 a E11-H7).
 */
export const TIPOS_MOVIMIENTO = {
  /** E11-H2, decisión del 25 de octubre de 2026: recepción de un proveedor. */
  ENTRADA: 'entrada',
  /** E11-H3, decisión del 25 de octubre de 2026: salidas que no son venta. */
  MERMA_VENCIMIENTO: 'merma_vencimiento',
  MERMA_DANO: 'merma_dano',
  CONSUMO_PELUQUERIA: 'consumo_peluqueria',
  /** E11-H4, decisión del 25 de octubre de 2026: corrección del conteo físico. */
  AJUSTE_POSITIVO: 'ajuste_positivo',
  AJUSTE_NEGATIVO: 'ajuste_negativo',
  /** E11-H4: un movimiento con la ubicación de origen y la de destino. */
  TRANSFERENCIA: 'transferencia',
  /** E11-H7, decisión del 28 de octubre de 2026: unidades reservadas por un pedido. */
  VENTA: 'venta',
  /** E11-H7: unidades de un pedido cancelado que vuelven a la ubicación de donde salieron. */
  REINGRESO: 'reingreso',
} as const;

/** Tipos de movimiento que se registran como salida que no es venta (E11-H3, RF-11.06). */
export const TIPOS_SALIDA = [
  TIPOS_MOVIMIENTO.MERMA_VENCIMIENTO,
  TIPOS_MOVIMIENTO.MERMA_DANO,
  TIPOS_MOVIMIENTO.CONSUMO_PELUQUERIA,
] as const;

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

/**
 * TOKEN_CORREO.tipo. Lista abierta: cada historia agrega el suyo.
 */
export const TIPOS_TOKEN = {
  /** E1-H1, decisión del 14 de octubre de 2026. */
  CONFIRMACION_CORREO: 'confirmacion_correo',
  /** E13-H1, decisión del 18 de octubre de 2026: el personal define su contraseña. */
  INVITACION_PERSONAL: 'invitacion_personal',
  /** E1-H4, decisión del 26 de octubre de 2026: enlace para definir una contraseña nueva. */
  RECUPERACION_CONTRASENA: 'recuperacion_contrasena',
} as const;

/**
 * NOTIFICACION.tipo. Lista abierta: cada historia que envía un correo agrega el suyo.
 */
export const TIPOS_NOTIFICACION = {
  /** E1-H1, decisión del 14 de octubre de 2026. */
  CONFIRMACION_CORREO: 'confirmacion_correo',
  /** E13-H1, decisión del 18 de octubre de 2026. */
  INVITACION_PERSONAL: 'invitacion_personal',
  /** E1-H4, decisión del 26 de octubre de 2026. */
  RECUPERACION_CONTRASENA: 'recuperacion_contrasena',
  /** E11-H6, decisión del 28 de octubre de 2026: un formato quedó bajo su stock mínimo. */
  STOCK_BAJO: 'stock_bajo',
  /** E8-H2: aviso al cliente de un cambio clave del estado de su pedido (RF-08.03). */
  CAMBIO_ESTADO_PEDIDO: 'cambio_estado_pedido',
  /** E6-H2, decisión del 31 de octubre de 2026: se recibió el pago del pedido (RF-06.06). */
  PAGO_CONFIRMADO: 'pago_confirmado',
} as const;

/**
 * Disponibilidad que la tienda muestra de un formato o pack (E2-H3, decisión del 26 de octubre de
 * 2026). No es una columna: se calcula con el stock vendible y no revela cuántas unidades hay.
 */
export const DISPONIBILIDADES = {
  DISPONIBLE: 'disponible',
  AGOTADO: 'agotado',
} as const;

/**
 * Por qué un artículo del carrito del navegador no se unió entero al de la cuenta (E5-H2,
 * decisión del 28 de octubre de 2026). No es una columna: va en la respuesta de la unión y no
 * revela cuántas unidades hay.
 */
export const AJUSTES_UNION_CARRITO = {
  /** No existe o la tienda no se lo vende a esa cuenta: se descarta. */
  NO_DISPONIBLE: 'no_disponible',
  /** Sin stock vendible: se descarta. */
  AGOTADO: 'agotado',
  /** La suma pasaba del tope por artículo: quedó en el tope. No se recorta al stock. */
  CANTIDAD_AJUSTADA: 'cantidad_ajustada',
} as const;

/** NOTIFICACION.estado_envio (decisión del 14 de octubre de 2026, E1-H1). */
export const ESTADOS_NOTIFICACION = {
  PENDIENTE: 'pendiente',
  ENVIADA: 'enviada',
  FALLIDA: 'fallida',
} as const;

export type Valor<T extends Record<string, string>> = T[keyof T];
