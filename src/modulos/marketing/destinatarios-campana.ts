import type { Prisma } from '../../generated/prisma/client.js';
import { ESTADOS_SIN_VENTA } from '../../common/dominio/valores.js';
import {
  type CuentaDestinataria,
  type Destinatarios,
  filtraPorCompras,
  filtraPorCuenta,
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
 * una sola vez (CA2). Los filtros de cuenta de SCRUM-150 (compras, ubicación, perfil, antigüedad y
 * carrito) se suman con AND; un pedido pagado es, igual, todo estado salvo `ESTADOS_SIN_VENTA`. Las
 * edades se cuentan con la fecha de hoy en Chile.
 */
export const buscarDestinatarios = async (
  cliente: Cliente,
  segmento: SegmentoCampana,
  categorias: number[],
): Promise<Destinatarios> => {
  const roles = rolesDelSegmento(segmento);
  const filtra = filtraPorCompras(segmento);
  const s = segmento;

  const cuentas =
    roles.length === 0
      ? []
      : await cliente.$queryRaw<CuentaDestinataria[]>`
          SELECT u.id_usuario AS id, u.email
          FROM usuario u
          LEFT JOIN LATERAL (
            SELECT count(*)::int AS pedidos,
                   COALESCE(sum(p.monto_total), 0)::int AS gasto,
                   max(p.fecha_pedido) AS ultima
            FROM pedido p
            WHERE p.id_usuario = u.id_usuario
              AND p.estado_actual <> ALL(${ESTADOS_SIN_VENTA}::text[])
          ) compras ON true
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
            -- Actividad de compra
            AND (${s.compraEnUltimosDias}::int IS NULL
              OR compras.ultima >= now() - make_interval(days => ${s.compraEnUltimosDias}::int))
            AND (${s.sinComprarHaceDias}::int IS NULL
              OR compras.ultima < now() - make_interval(days => ${s.sinComprarHaceDias}::int))
            AND (${s.pedidosMinimo}::int IS NULL OR compras.pedidos >= ${s.pedidosMinimo}::int)
            AND (${s.pedidosMaximo}::int IS NULL OR compras.pedidos <= ${s.pedidosMaximo}::int)
            AND (${s.gastoMinimo}::int IS NULL OR compras.gasto >= ${s.gastoMinimo}::int)
            AND (${s.gastoMaximo}::int IS NULL OR compras.gasto <= ${s.gastoMaximo}::int)
            -- Ubicación: alguna dirección guardada en una de las regiones o comunas
            AND (
              (cardinality(${s.regiones}::int[]) = 0 AND cardinality(${s.comunas}::int[]) = 0)
              OR EXISTS (
                SELECT 1
                FROM direccion di
                JOIN comuna co ON co.id_comuna = di.id_comuna
                WHERE di.id_usuario = u.id_usuario
                  AND (co.id_region = ANY(${s.regiones}::int[])
                    OR di.id_comuna = ANY(${s.comunas}::int[]))
              )
            )
            -- Perfil
            AND (cardinality(${s.mesesCumpleanos}::int[]) = 0
              OR extract(month FROM u.fecha_nacimiento)::int = ANY(${s.mesesCumpleanos}::int[]))
            AND (${s.edadMinima}::int IS NULL
              OR date_part('year', age((now() AT TIME ZONE 'America/Santiago')::date, u.fecha_nacimiento))::int >= ${s.edadMinima}::int)
            AND (${s.edadMaxima}::int IS NULL
              OR date_part('year', age((now() AT TIME ZONE 'America/Santiago')::date, u.fecha_nacimiento))::int <= ${s.edadMaxima}::int)
            AND (cardinality(${s.generos}::text[]) = 0 OR u.genero = ANY(${s.generos}::text[]))
            -- Antigüedad de la cuenta y carrito
            AND (${s.registroUltimosDias}::int IS NULL
              OR u.fecha_registro >= now() - make_interval(days => ${s.registroUltimosDias}::int))
            AND (${s.registroHaceMasDias}::int IS NULL
              OR u.fecha_registro < now() - make_interval(days => ${s.registroHaceMasDias}::int))
            AND (NOT ${s.conCarrito}::boolean OR EXISTS (
              SELECT 1
              FROM carrito ca
              JOIN item_carrito ic ON ic.id_carrito = ca.id_carrito
              WHERE ca.id_usuario = u.id_usuario
            ))
          ORDER BY u.id_usuario`;

  // Los suscriptores no tienen compras ni datos de cuenta: con un filtro de cuenta no entran. Si su correo es el de
  // una cuenta, decide la cuenta (decisión del 5 nov): aunque no acepte o sea del personal, el LEAD
  // no la hace recibir publicidad. Ambos correos se guardan en minúsculas
  const suscriptores =
    incluyeSuscriptores(segmento) && !filtraPorCuenta(segmento)
      ? await cliente.$queryRaw<SuscriptorDestinatario[]>`
          SELECT l.id_lead AS id, l.email
          FROM lead l
          WHERE l.activo
            AND NOT EXISTS (SELECT 1 FROM usuario u WHERE u.email = l.email)
          ORDER BY l.id_lead`
      : [];

  return unirDestinatarios(cuentas, suscriptores);
};
