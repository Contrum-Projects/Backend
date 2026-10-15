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
} as const;

/**
 * Prioridad de los correos (RNF-16): en BullMQ, número menor = sale antes.
 */
export const PRIORIDAD_CORREO = {
  PEDIDO_Y_CUENTA: 1,
  SUSCRIPCION: 5,
  PUBLICIDAD: 10,
} as const;
