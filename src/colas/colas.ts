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
  /**
   * Envío de campañas de marketing. Sin uso por ahora: E12-H3 crea las NOTIFICACION al confirmar y
   * las encola en `correos` (decisión del 5 de noviembre de 2026).
   */
  CAMPANAS: 'campanas',
  /** Tareas con plazo del pago: vencimiento a los 15 min (RNF-31). */
  PLAZOS: 'plazos',
  /**
   * Consulta del estado de los envíos (E7-H3). Va aparte de `plazos`: un worker toma cualquier
   * trabajo de su cola y un courier lento atrasaría la cancelación por impago (RNF-31).
   */
  SEGUIMIENTO_ENVIOS: 'seguimiento-envios',
  /**
   * Recordatorios de carritos abandonados (E12-H4). Va aparte de `plazos` por lo mismo que el
   * seguimiento: un worker toma cualquier trabajo de su cola, y esta tarea vive en otro módulo.
   */
  CARRITOS_ABANDONADOS: 'carritos-abandonados',
  /**
   * Eliminación de los archivos de verificación que ya no hacen falta (E10-H6). Va aparte de
   * `plazos`: borrar en R2 puede tardar y no debe atrasar la cancelación por impago (RNF-31).
   */
  LIMPIEZA_VERIFICACIONES: 'limpieza-verificaciones',
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
  /** Aviso al solicitante de que su cuenta quedó verificada como profesional (E10-H4). */
  VERIFICACION_APROBADA: 'verificacion-aprobada',
  /** Enlace para confirmar la suscripción a las ofertas, sin cuenta (E12-H1). */
  CONFIRMACION_SUSCRIPCION: 'confirmacion-suscripcion',
  /** Aviso con el motivo de que la cuenta profesional volvió a ser de cliente (E13-H3). */
  ROL_PROFESIONAL_RETIRADO: 'rol-profesional-retirado',
  /** Recordatorio de un carrito abandonado, que es publicidad (E12-H4). */
  RECORDATORIO_CARRITO: 'recordatorio-carrito',
  /** Correo de una campaña, que es publicidad (E12-H3). */
  CAMPANA: 'campana',
  /** Tarea repetible: reencola los correos pendientes si Redis se cayó o se vació (RNF-29). */
  REVISAR_PENDIENTES: 'revisar-pendientes',
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

/** Nombres de los trabajos de la cola de carritos abandonados. */
export const TRABAJOS_CARRITO_ABANDONADO = {
  /** Tarea repetible: envía los recordatorios que ya vencieron (E12-H4). */
  RECORDAR: 'recordar-carritos',
} as const;

/** Nombres de los trabajos de la cola de limpieza de verificaciones. */
export const TRABAJOS_LIMPIEZA_VERIFICACION = {
  /** Tarea repetible: elimina los archivos de solicitudes resueltas hace 30 días (E10-H6). */
  ELIMINAR_ARCHIVOS: 'eliminar-archivos',
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

/** Datos del correo que avisa que la cuenta quedó verificada como profesional (E10-H4). */
export interface TrabajoVerificacionAprobada {
  notificacionId: number;
  destinatario: string;
  nombre: string;
}

/**
 * Datos del correo que avisa que la cuenta profesional volvió a ser de cliente (E13-H3). El motivo
 * no viaja en el trabajo: se lee de HISTORIAL_ROL al enviar, así un correo reencolado sale igual
 * y el texto no queda en Redis.
 */
export interface TrabajoRolProfesionalRetirado {
  notificacionId: number;
  destinatario: string;
  nombre: string;
}

/**
 * Datos del correo que confirma la suscripción a las ofertas (E12-H1). El suscriptor no tiene
 * nombre: solo su correo. El enlace lleva el token firmado, por eso el trabajo se borra de Redis
 * al terminar, como los de cuenta.
 */
export interface TrabajoConfirmacionSuscripcion {
  notificacionId: number;
  destinatario: string;
  enlace: string;
}

/**
 * Stock bajo reencolado por la revisión (RNF-29): NOTIFICACION no guarda el formato, así que el
 * correo sale sin sus cifras y remite al panel.
 */
export interface TrabajoStockBajoRecuperado {
  notificacionId: number;
  destinatario: string;
  nombre: string;
}

/**
 * Datos del recordatorio de un carrito abandonado (E12-H4). Los artículos no viajan en el trabajo:
 * se leen del carrito al enviar, así un correo reencolado sale igual (RNF-29).
 */
export interface TrabajoRecordatorioCarrito {
  notificacionId: number;
  destinatario: string;
  nombre: string;
}

/**
 * Datos de un correo de campaña (E12-H3). El asunto y el cuerpo no viajan en el trabajo: se leen
 * de CAMPANA al enviar, así un correo reencolado sale igual y el texto no queda en Redis (RNF-29).
 */
export interface TrabajoCampana {
  notificacionId: number;
  destinatario: string;
}

/** Lo que puede traer un trabajo de envío de la cola de correos. */
export type TrabajoCorreo =
  | TrabajoCorreoConEnlace
  | TrabajoStockBajo
  | TrabajoStockBajoRecuperado
  | TrabajoCambioEstadoPedido
  | TrabajoPagoConfirmado
  | TrabajoVerificacionAprobada
  | TrabajoRolProfesionalRetirado
  | TrabajoConfirmacionSuscripcion
  | TrabajoRecordatorioCarrito
  | TrabajoCampana;

/**
 * Prioridad de los correos (RNF-16): en BullMQ, número menor = sale antes.
 */
export const PRIORIDAD_CORREO = {
  PEDIDO_Y_CUENTA: 1,
  SUSCRIPCION: 5,
  PUBLICIDAD: 10,
} as const;
