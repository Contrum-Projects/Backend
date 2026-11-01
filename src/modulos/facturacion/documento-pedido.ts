import { TIPOS_DOCUMENTO } from '../../common/dominio/valores.js';
import type { Prisma } from '../../generated/prisma/client.js';

/**
 * La factura vigente de un pedido con su archivo ya registrado: no está anulada y tiene PDF. La
 * leen el detalle del pedido (E8-H1) y la descarga (E9-H4), para que digan lo mismo.
 */
export const FACTURA_CON_ARCHIVO = {
  tipo: TIPOS_DOCUMENTO.FACTURA,
  anuladorId: null,
  ubicacionArchivo: { not: null },
} satisfies Prisma.DocumentoTributarioWhereInput;

/**
 * Cómo se ve el documento del pedido en el detalle (E9-H4). PROPUESTA por confirmar: `pendiente`
 * si la factura aún no se registra y `disponible` si ya se puede descargar.
 */
export const ESTADOS_DESCARGA_DOCUMENTO = {
  PENDIENTE: 'pendiente',
  DISPONIBLE: 'disponible',
} as const;

export interface DocumentoPedido {
  tipo: typeof TIPOS_DOCUMENTO.FACTURA;
  estado: (typeof ESTADOS_DESCARGA_DOCUMENTO)[keyof typeof ESTADOS_DESCARGA_DOCUMENTO];
  /** Folio de la factura; `null` mientras está pendiente. */
  folio: number | null;
  /** Fecha de emisión, `AAAA-MM-DD`; `null` mientras está pendiente. */
  fechaEmision: string | null;
}
