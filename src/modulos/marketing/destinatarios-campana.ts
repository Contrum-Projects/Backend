import type { Prisma } from '../../generated/prisma/client.js';
import { ESTADOS_SIN_VENTA } from '../../common/dominio/valores.js';
import {
  type CuentaDestinataria,
  type Destinatarios,
  filtraPorCompras,
  incluyeSuscriptores,
  rolesDelSegmento,
  type SegmentoCampana,
  type SuscriptorDestinatario,
  unirDestinatarios,
} from './segmento-campana.js';

type Cliente = Prisma.TransactionClient;

/**
 * Quiénes reciben una campaña (E12-H3). Solo quien acepta publicidad (RF-12.08, CA3): cuentas
 * activas, con el correo verificado y que aceptan ofertas, y suscriptores confirmados sin baja
 * (LEAD activo, sin cuenta con el mismo correo). Con un filtro de compras, solo cuentas con un pedido pagado (todo estado salvo
 * `ESTADOS_SIN_VENTA`, como el reporte de ventas) con algún producto de las categorías (ya con sus
 * subcategorías) o de las marcas; un pack cuenta por los productos de sus formatos. Cada dirección,
 * una sola vez (CA2).
 */
export const buscarDestinatarios = async (
  cliente: Cliente,
  segmento: SegmentoCampana,
  categorias: number[],
): Promise<Destinatarios> => {
  const roles = rolesDelSegmento(segmento);
  const filtra = filtraPorCompras(segmento);

  const cuentas =
    roles.length === 0
      ? []
      : await cliente.$queryRaw<CuentaDestinataria[]>`
          SELECT u.id_usuario AS id, u.email
          FROM usuario u
          WHERE u.activo
            AND u.acepta_marketing_email
            AND u.fecha_verificacion_correo IS NOT NULL
            AND u.rol = ANY(${roles}::text[])
            AND (
              NOT ${filtra}::boolean
              OR EXISTS (
                SELECT 1
                FROM pedido p
                JOIN detalle_pedido d ON d.id_pedido = p.id_pedido
                LEFT JOIN componente_pack cp ON cp.id_pack = d.id_articulo
                JOIN formato_producto f
                  ON f.id_formato = COALESCE(cp.id_formato, d.id_articulo)
                JOIN producto pr ON pr.id_producto = f.id_producto
                WHERE p.id_usuario = u.id_usuario
                  AND p.estado_actual <> ALL(${ESTADOS_SIN_VENTA}::text[])
                  AND (
                    pr.id_categoria = ANY(${categorias}::int[])
                    OR pr.id_marca = ANY(${segmento.marcas}::int[])
                  )
              )
            )
          ORDER BY u.id_usuario`;

  // Los suscriptores no tienen compras: con un filtro de compras no entran. Si su correo es el de
  // una cuenta, decide la cuenta (decisión del 5 nov): aunque no acepte o sea del personal, el LEAD
  // no la hace recibir publicidad. Ambos correos se guardan en minúsculas
  const suscriptores =
    incluyeSuscriptores(segmento) && !filtra
      ? await cliente.$queryRaw<SuscriptorDestinatario[]>`
          SELECT l.id_lead AS id, l.email
          FROM lead l
          WHERE l.activo
            AND NOT EXISTS (SELECT 1 FROM usuario u WHERE u.email = l.email)
          ORDER BY l.id_lead`
      : [];

  return unirDestinatarios(cuentas, suscriptores);
};
