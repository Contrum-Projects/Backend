/**
 * Valores permitidos de las columnas de estado y tipo que los documentos del
 * proyecto ya definen. Las columnas son VARCHAR en la base; valida contra estas
 * listas en los DTOs (`@IsIn(Object.values(...))`) y en los servicios.
 *
 * Si una lista cambia, actualízala aquí y en docs/reglas-de-negocio.md.
 * Listas que siguen abiertas (no las inventes): estados de envío (solo el
 * provisional de E5-H3). Las modalidades y especialidades son una propuesta por
 * confirmar con la clienta (E10-H5). Los tipos de token y de notificación crecen
 * con cada historia que los necesita.
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
 * Grupos del filtro de pedidos del panel (E8-H2, decisión del 6 nov 2026, SCRUM-150), en el
 * orden de los chips. `estados` vacío es «todos». Solo los grupos que piden una acción muestran
 * su conteo. Entregados, retirados y cancelados se ven solo en «todos».
 */
export const GRUPOS_PEDIDOS_GESTION = [
  {
    clave: 'por_preparar',
    nombre: 'Por preparar',
    estados: [ESTADOS_PEDIDO.PAGADO, ESTADOS_PEDIDO.EN_PREPARACION],
    conConteo: true,
  },
  {
    clave: 'listos_para_retiro',
    nombre: 'Listos para retiro',
    estados: [ESTADOS_PEDIDO.LISTO_PARA_RETIRO],
    conConteo: true,
  },
  {
    clave: 'despachados',
    nombre: 'Despachados',
    estados: [ESTADOS_PEDIDO.DESPACHADO],
    conConteo: false,
  },
  {
    clave: 'pendientes_pago',
    nombre: 'Pendientes de pago',
    estados: [ESTADOS_PEDIDO.PENDIENTE_PAGO],
    conConteo: false,
  },
  { clave: 'todos', nombre: 'Todos', estados: [], conConteo: false },
] as const satisfies readonly {
  clave: string;
  nombre: string;
  estados: readonly string[];
  conConteo: boolean;
}[];

/** El grupo que se aplica si la consulta no trae uno. */
export const GRUPO_PEDIDOS_POR_DEFECTO = 'por_preparar';

/**
 * Estado de un objetivo del proyecto frente a su meta (E14-H1, SCRUM-150): lo decide el backend,
 * así la pantalla no compara porcentajes (RNF-03).
 */
export const ESTADOS_OBJETIVO = {
  SOBRE_LA_META: 'sobre-la-meta',
  BAJO_LA_META: 'bajo-la-meta',
  SIN_DATOS: 'sin-datos',
} as const;

/**
 * Orden del listado de la tienda (E2-H1, decisión del 6 nov 2026, SCRUM-150). Sin orden, por
 * nombre. «más vendidos»: unidades vendidas de sus formatos en los últimos
 * `DIAS_MAS_VENDIDOS` días, en pedidos que son venta (`ESTADOS_SIN_VENTA`); «novedades»: el
 * producto creado más recientemente primero. Los empates, por nombre.
 */
export const ORDENES_TIENDA = {
  MAS_VENDIDOS: 'mas-vendidos',
  NOVEDADES: 'novedades',
} as const;

/** Días hacia atrás que cuentan para «más vendidos» (decisión del 6 nov 2026). */
export const DIAS_MAS_VENDIDOS = 30;

/**
 * Un pedido es venta desde que se paga (decisión del 4 nov 2026): quedan fuera los que esperan el
 * pago y los cancelados. Un pedido pagado ya no se cancela (E8-H3). Lo usan los reportes (E14) y
 * el filtro de compras de las campañas (E12-H3).
 */
export const ESTADOS_SIN_VENTA: readonly string[] = [
  ESTADOS_PEDIDO.PENDIENTE_PAGO,
  ESTADOS_PEDIDO.CANCELADO,
];

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
 * ENVIO.estado_envio (E7-H3, decisión del 1 de noviembre de 2026). Nace `pendiente` (E5-H3), pasa a
 * `en_transito` al despacharse y después sigue lo que informa Chilexpress.
 */
export const ESTADOS_ENVIO = {
  PENDIENTE: 'pendiente',
  EN_TRANSITO: 'en_transito',
  EN_REPARTO: 'en_reparto',
  ENTREGADO: 'entregado',
  CON_PROBLEMA: 'con_problema',
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

/**
 * Estado de la factura de un pedido en el panel de facturas (`GET /api/gestion/facturas`, SCRUM-55;
 * decisión del 6 nov, SCRUM-150). No es una columna: se deduce de si el pedido que pidió factura ya
 * tiene su DOCUMENTO_TRIBUTARIO registrado. Sin factura registrada, el campo `factura` del pedido
 * viene `null`.
 */
export const ESTADOS_FACTURA_GESTION = {
  POR_EMITIR: 'por_emitir',
  EMITIDA: 'emitida',
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

/**
 * Grupos del filtro de movimientos del panel (E11-H5 criterio 2, decisión del 6 nov 2026,
 * SCRUM-150): «entradas» suma stock (entrada, ajuste positivo y reingreso de un pedido
 * cancelado), «salidas» lo resta sin ser venta (mermas, consumo y ajuste negativo).
 */
export const GRUPOS_MOVIMIENTO = {
  ENTRADAS: 'entradas',
  VENTAS: 'ventas',
  SALIDAS: 'salidas',
  TRANSFERENCIAS: 'transferencias',
} as const;

/** Los tipos de movimiento de cada grupo; cada tipo está en uno solo. */
export const TIPOS_POR_GRUPO_MOVIMIENTO: Readonly<
  Record<
    (typeof GRUPOS_MOVIMIENTO)[keyof typeof GRUPOS_MOVIMIENTO],
    readonly (typeof TIPOS_MOVIMIENTO)[keyof typeof TIPOS_MOVIMIENTO][]
  >
> = Object.freeze({
  [GRUPOS_MOVIMIENTO.ENTRADAS]: [
    TIPOS_MOVIMIENTO.ENTRADA,
    TIPOS_MOVIMIENTO.AJUSTE_POSITIVO,
    TIPOS_MOVIMIENTO.REINGRESO,
  ],
  [GRUPOS_MOVIMIENTO.VENTAS]: [TIPOS_MOVIMIENTO.VENTA],
  [GRUPOS_MOVIMIENTO.SALIDAS]: [
    TIPOS_MOVIMIENTO.MERMA_VENCIMIENTO,
    TIPOS_MOVIMIENTO.MERMA_DANO,
    TIPOS_MOVIMIENTO.CONSUMO_PELUQUERIA,
    TIPOS_MOVIMIENTO.AJUSTE_NEGATIVO,
  ],
  [GRUPOS_MOVIMIENTO.TRANSFERENCIAS]: [TIPOS_MOVIMIENTO.TRANSFERENCIA],
});

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

/**
 * SOLICITUD_VERIFICACION.resultado_consulta_sii (E10-H1, decisión del 2 de noviembre de 2026): lo
 * que dio la consulta automática del inicio de actividades. Solo `aprobado` aprueba la solicitud;
 * cualquier otro resultado la deja `pendiente` a la espera de documentos (E10-H2). Es lo que el
 * personal ve al revisar: nunca se le muestra a quien solicita.
 */
export const RESULTADOS_CONSULTA_SII = {
  APROBADO: 'aprobado',
  SIN_INICIO_ACTIVIDADES: 'sin_inicio_actividades',
  OTRO_GIRO: 'otro_giro',
  NO_DISPONIBLE: 'no_disponible',
  /** Tiene el giro, pero el nombre del contribuyente no calza con el de la cuenta (SCRUM-163). */
  NOMBRE_NO_COINCIDE: 'nombre_no_coincide',
} as const;

/** SOLICITUD_VERIFICACION.proveedor_consulta_sii: quién respondió la consulta al SII. */
export const PROVEEDORES_SII = {
  KHIPU: 'khipu',
  SIMULADO: 'simulado',
} as const;

/**
 * Giro del SII que acredita al peluquero: 960200, «Peluquería y otros tratamientos de belleza»
 * (E10-H1, decisión del 2 de noviembre de 2026).
 */
export const GIRO_PELUQUERIA = '960200';

/**
 * ANTECEDENTE.tipo: el documento con que quien no pasó la verificación automática acredita su
 * oficio (E10-H2, propuesta del 2 de noviembre de 2026, por confirmar con el equipo). Lo elige quien
 * lo sube. El inicio de actividades ya no se adjunta: se consulta al SII (E10-H1). El carnet no se
 * pide: lleva demasiados datos confidenciales. Un certificado de curso vale como `certificado`.
 */
export const TIPOS_ANTECEDENTE = {
  TITULO: 'titulo',
  CERTIFICADO: 'certificado',
  OTRO: 'otro',
} as const;

/**
 * ANTECEDENTE.estado_ocr. Sin OCR (decisión del 2 de noviembre de 2026): los documentos los
 * revisa el personal, así que ninguno se procesa. La columna es obligatoria y queda con este valor.
 */
export const ESTADOS_OCR = {
  NO_APLICA: 'no_aplica',
} as const;

/**
 * CUPON.tipo_descuento (decisión del 7 de noviembre de 2026, SCRUM-150): un porcentaje (1 a 100,
 * con tope opcional en pesos) o un monto fijo en pesos con IVA.
 */
export const TIPOS_DESCUENTO_CUPON = {
  PORCENTAJE: 'porcentaje',
  MONTO_FIJO: 'monto_fijo',
} as const;

/**
 * CUPON.alcance (decisión del 7 de noviembre de 2026, SCRUM-150): todo el pedido (sin el despacho),
 * ciertos formatos o packs, o los productos de ciertas categorías o marcas (un pack, solo si todos
 * sus componentes calzan).
 */
export const ALCANCES_CUPON = {
  PEDIDO: 'pedido',
  ARTICULOS: 'articulos',
  CATEGORIAS_MARCAS: 'categorias_marcas',
} as const;

/** CAMPANA.tipo: campaña de envío único o saludo de cumpleaños. */
export const TIPOS_CAMPANA = {
  ENVIO_UNICO: 'envio_unico',
  CUMPLEANOS: 'cumpleanos',
} as const;

/**
 * A quién va una campaña (E12-H3, decisión del 5 de noviembre de 2026): cuentas cliente, cuentas
 * profesional o suscriptores sin cuenta (LEAD). Va en `campana.segmento`.
 */
export const TIPOS_DESTINATARIO_CAMPANA = {
  CLIENTE: 'cliente',
  PROFESIONAL: 'profesional',
  SUSCRIPTOR: 'suscriptor',
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
  /** E10-H4, decisión del 3 de noviembre de 2026: la cuenta quedó verificada como profesional (RF-10.08). */
  VERIFICACION_APROBADA: 'verificacion_aprobada',
  /** E12-H1, decisión del 3 de noviembre de 2026: enlace para confirmar la suscripción a ofertas. */
  CONFIRMACION_SUSCRIPCION: 'confirmacion_suscripcion',
  /** E13-H3, decisión del 4 de noviembre de 2026: el profesional volvió a ser cliente, con el motivo. */
  ROL_PROFESIONAL_RETIRADO: 'rol_profesional_retirado',
  /** E12-H4, decisión del 4 de noviembre de 2026: recordatorio de un carrito abandonado (RF-12.04). */
  RECORDATORIO_CARRITO: 'recordatorio_carrito',
  /** E12-H3, decisión del 5 de noviembre de 2026: correo de una campaña (lleva `id_campana`). */
  CAMPANA: 'campana',
  /**
   * E12-H5, decisión del 5 de noviembre de 2026: saludo de cumpleaños (RF-12.10), con la oferta si
   * está activa (RF-12.11). Lleva `id_campana` si el saludo ya se configuró.
   */
  CUMPLEANOS: 'cumpleanos',
} as const;

/**
 * Tipos de NOTIFICACION que son publicidad (E12-H2, decisión del 4 de noviembre de 2026), además de
 * toda notificación con campaña. Antes de enviarlos se revisa de nuevo el consentimiento de la
 * dirección. Lista abierta: cada historia que agregue un correo publicitario sin campaña suma su
 * tipo aquí.
 */
export const TIPOS_NOTIFICACION_PUBLICIDAD: readonly string[] = [
  TIPOS_NOTIFICACION.RECORDATORIO_CARRITO,
  TIPOS_NOTIFICACION.CUMPLEANOS,
];

/**
 * LEAD.origen (E12-H1, decisión del 3 de noviembre de 2026): de dónde vino la suscripción. Lista
 * abierta: por ahora solo el formulario público de la tienda.
 */
export const ORIGENES_LEAD = {
  FORMULARIO_WEB: 'formulario_web',
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

/**
 * NOTIFICACION.estado_envio (decisión del 14 de octubre de 2026, E1-H1). `cancelada` (E12-H2,
 * decisión del 4 de noviembre de 2026): publicidad que no se envió porque la dirección ya no la
 * acepta, o un recordatorio de carrito que ya no corresponde porque el carrito cambió (E12-H4).
 * `rebotada` (E12-H6, decisión del 5 de noviembre de 2026): el servidor de destino lo rechazó
 * para siempre, según el aviso de Resend; su dirección deja de recibir publicidad.
 */
export const ESTADOS_NOTIFICACION = {
  PENDIENTE: 'pendiente',
  ENVIADA: 'enviada',
  FALLIDA: 'fallida',
  CANCELADA: 'cancelada',
  REBOTADA: 'rebotada',
} as const;

/**
 * PERFIL_PROFESIONAL.modalidad (E10-H5, propuesta del 4 de noviembre de 2026, por confirmar con la
 * clienta): cómo trabaja el peluquero. Se elige una sola; sin opción «otra».
 */
export const MODALIDADES_TRABAJO = {
  /** Trabaja con contrato o boleta en un salón ajeno. */
  DEPENDIENTE_SALON: 'dependiente_salon',
  /** Arrienda un puesto en un salón y atiende a sus propias clientas. */
  ARRIENDO_SILLON: 'arriendo_sillon',
  /** Dueña o dueño de un salón o peluquería. */
  SALON_PROPIO: 'salon_propio',
  /** Atiende en la casa de la clienta. */
  DOMICILIO_CLIENTA: 'domicilio_clienta',
  /** Recibe clientas en su propia casa. */
  DOMICILIO_PROPIO: 'domicilio_propio',
  /** Novias, fotografía, televisión o desfiles. */
  EVENTOS_PRODUCCIONES: 'eventos_producciones',
  /** Academia, instituto o capacitaciones de marca. */
  DOCENTE: 'docente',
} as const;

/**
 * PERFIL_PROFESIONAL.especialidades (E10-H5, propuesta del 4 de noviembre de 2026, por confirmar
 * con la clienta): una o varias, sin repetir; sin opción «otra». Agrupadas como en la propuesta.
 */
export const ESPECIALIDADES = {
  // Corte y peinado
  CORTE_DAMA: 'corte_dama',
  CORTE_VARON_BARBERIA: 'corte_varon_barberia',
  PEINADOS_RECOGIDOS: 'peinados_recogidos',
  BRUSHING_PLANCHADO: 'brushing_planchado',
  // Color
  COLORACION_TINTURAS: 'coloracion_tinturas',
  MECHAS_BALAYAGE: 'mechas_balayage',
  DECOLORACION_CORRECCION: 'decoloracion_correccion',
  CANAS_MATIZACION: 'canas_matizacion',
  // Tratamientos y alisados
  ALISADOS: 'alisados',
  PERMANENTE_ONDULACION: 'permanente_ondulacion',
  TRATAMIENTOS_REPARACION: 'tratamientos_reparacion',
  TRICOLOGIA: 'tricologia',
  // Otros
  EXTENSIONES_PELUCAS: 'extensiones_pelucas',
  RIZADO_AFRO: 'rizado_afro',
  PELUQUERIA_INFANTIL: 'peluqueria_infantil',
  NOVIAS_EVENTOS: 'novias_eventos',
} as const;

export type Valor<T extends Record<string, string>> = T[keyof T];

/**
 * SLIDE_PORTADA.tipo_destino (SCRUM-157): a dónde lleva un slide de la portada del inicio. El
 * destino se elige de una lista; nunca es una URL escrita.
 */
export const TIPOS_DESTINO_PORTADA = {
  PRODUCTO: 'producto',
  PACK: 'pack',
  CATEGORIA: 'categoria',
  MARCA: 'marca',
  PAGINA: 'pagina',
} as const;

/**
 * Páginas de la tienda a las que puede llevar un slide (`tipo_destino` = `pagina`, SCRUM-157).
 * El frontend arma la ruta de cada una.
 */
export const PAGINAS_PORTADA = {
  CATALOGO: 'catalogo',
  PACKS: 'packs',
  PRECIO_PROFESIONAL: 'precio-profesional',
} as const;
