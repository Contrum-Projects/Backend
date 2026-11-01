/**
 * Colas de trabajo (BullMQ sobre Redis). Decisión del 9 de octubre de 2026.
 *
 * El estado de cada trabajo vive también en PostgreSQL (NOTIFICACIÓN, EVENTO_PAGO,
 * SOLICITUD_VERIFICACIÓN); una revisión periódica reencola lo pendiente si Redis
 * se vacía (RNF-29).
 *
 * Para registrar una cola en un módulo:
 *   imports: [BullModule.registerQueue({ name: COLAS.CORREOS })]
 * y para encolar:
 *   @InjectQueue(COLAS.CORREOS) private readonly correos: Queue
 */
export const COLAS = {
  /** Correos de pedido, cuenta, suscripción y publicidad (prioridades en PRIORIDAD_CORREO). */
  CORREOS: 'correos',
  /** Notificaciones de Mercado Pago: se responden al tiro y se procesan aquí (RNF-15). */
  EVENTOS_PAGO: 'eventos-pago',
  /** OCR de antecedentes de la verificación profesional. */
  OCR: 'ocr',
  /** Envío de campañas de marketing. */
  CAMPANAS: 'campanas',
  /** Tareas con plazo: vencimiento del pago (15 min), recordatorio de carrito, etc. (RNF-31). */
  PLAZOS: 'plazos',
  /**
   * Consulta del estado de los envíos (E7-H3). Va aparte de `plazos`: un worker toma cualquier
   * trabajo de su cola y un courier lento atrasaría la cancelación por impago (RNF-31).
   */
  SEGUIMIENTO_ENVIOS: 'seguimiento-envios',
} as const;

/** Nombres de los trabajos de la cola de correos. */
export const TRABAJOS_CORREO = {
  CONFIRMACION_CORREO: 'confirmacion-correo',
  /** Invitación al personal para definir su contraseña (E13-H1). */
  INVITACION_PERSONAL: 'invitacion-personal',
  /** Enlace para recuperar la contraseña (E1-H4). */
  RECUPERACION_CONTRASENA: 'recuperacion-contrasena',
  /** Aviso al personal de bodega y administración: un formato quedó bajo su mínimo (E11-H6). */
  STOCK_BAJO: 'stock-bajo',
  /** Aviso al cliente de un cambio clave del estado de su pedido (E8-H2). */
  CAMBIO_ESTADO_PEDIDO: 'cambio-estado-pedido',
  /** Confirmación al cliente de que se recibió el pago de su pedido (E6-H2). */
  PAGO_CONFIRMADO: 'pago-confirmado',
} as const;

/** Nombres de los trabajos de la cola de eventos de pago (E6-H2). */
export const TRABAJOS_EVENTO_PAGO = {
  PROCESAR: 'procesar-evento',
  /** Tarea repetible: reencola lo pendiente si Redis se cayó o se vació (RNF-29). */
  REVISAR_PENDIENTES: 'revisar-pendientes',
} as const;

/** Nombres de los trabajos de la cola de plazos. */
export const TRABAJOS_PLAZO = {
  /** Tarea repetible: cancela los pedidos con el plazo de pago vencido (E6-H3). */
  CANCELAR_IMPAGOS: 'cancelar-impagos',
} as const;

/** Nombres de los trabajos de la cola de seguimiento de envíos. */
export const TRABAJOS_SEGUIMIENTO = {
  /** Tarea repetible: consulta al courier el estado de los envíos en camino (E7-H3). */
  ACTUALIZAR_ENVIOS: 'actualizar-envios',
} as const;

/** Datos de una notificación de Mercado Pago por procesar: el resto está en EVENTO_PAGO. */
export interface TrabajoProcesarEventoPago {
  eventoId: number;
}

/**
 * Datos de un correo con enlace de un uso: confirmación del correo (E1-H1),
 * invitación al personal (E13-H1) y recuperación de la contraseña (E1-H4). El
 * enlace lleva el token en claro, por eso el trabajo se borra de Redis al
 * terminar (bien o mal).
 */
export interface TrabajoCorreoConEnlace {
  notificacionId: number;
  destinatario: string;
  nombre: string;
  enlace: string;
}

export type TrabajoConfirmacionCorreo = TrabajoCorreoConEnlace;
export type TrabajoInvitacionPersonal = TrabajoCorreoConEnlace;
export type TrabajoRecuperacionContrasena = TrabajoCorreoConEnlace;

/** Datos del correo de stock bajo el mínimo (E11-H6): uno por destinatario. */
export interface TrabajoStockBajo {
  notificacionId: number;
  destinatario: string;
  nombre: string;
  formato: { id: number; sku: string; producto: string; nombreFormato: string };
  stockTotal: number;
  stockMinimo: number;
}

/** Datos del correo al cliente por un cambio clave del estado de su pedido (E8-H2). */
export interface TrabajoCambioEstadoPedido {
  notificacionId: number;
  destinatario: string;
  nombre: string;
  codigoPedido: string;
  /** Nuevo estado del pedido (`ESTADOS_PEDIDO`). */
  estado: string;
  /** `despacho` o `retiro` (`TIPOS_ENTREGA`). */
  tipoEntrega: string;
}

/** Datos del correo al cliente que confirma el pago de su pedido (E6-H2). */
export interface TrabajoPagoConfirmado {
  notificacionId: number;
  destinatario: string;
  nombre: string;
  codigoPedido: string;
  montoTotal: number;
}

/**
 * Prioridad de los correos (RNF-16): en BullMQ, número menor = sale antes.
 */
export const PRIORIDAD_CORREO = {
  PEDIDO_Y_CUENTA: 1,
  SUSCRIPCION: 5,
  PUBLICIDAD: 10,
} as const;
