import { ConflictException } from '@nestjs/common';
import { TIPOS_DESTINO_PORTADA } from '../../common/dominio/valores.js';
import { Prisma } from '../../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

/** Dónde se usa una marca o una categoría; con alguno distinto de 0 no se puede borrar. */
export interface UsosCatalogo {
  productos: number;
  /** Solo en categorías. */
  subcategorias?: number;
  cupones: number;
  /** Imágenes de la portada que llevan a ella (SCRUM-157). */
  portada: number;
}

const contar = (cantidad: number, singular: string, plural: string) =>
  `${cantidad} ${cantidad === 1 ? singular : plural}`;

/** «4 productos, 1 cupón y 1 imagen de la portada», solo con los que no son 0. */
const enumerar = (usos: UsosCatalogo): string => {
  const partes = [
    usos.productos && contar(usos.productos, 'producto', 'productos'),
    usos.subcategorias &&
      contar(usos.subcategorias, 'subcategoría', 'subcategorías'),
    usos.cupones && contar(usos.cupones, 'cupón', 'cupones'),
    usos.portada &&
      contar(usos.portada, 'imagen de la portada', 'imágenes de la portada'),
  ].filter((parte): parte is string => Boolean(parte));
  return partes.length > 1
    ? `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`
    : (partes[0] ?? '');
};

/**
 * Si la marca o la categoría se usa, responde 409 con dónde (SCRUM-158): «No se puede borrar:
 * la usan 4 productos y 1 cupón. Cámbialos a otra marca antes de borrarla.»
 */
export const exigirSinUsos = (
  usos: UsosCatalogo,
  que: 'marca' | 'categoría',
): void => {
  const detalle = enumerar(usos);
  if (!detalle) return;
  const verbo =
    usos.productos + (usos.subcategorias ?? 0) + usos.cupones + usos.portada ===
    1
      ? 'la usa'
      : 'la usan';
  throw new ConflictException(
    `No se puede borrar: ${verbo} ${detalle}. Cámbialos a otra ${que} antes de borrarla.`,
  );
};

/** Imágenes de la portada que llevan a esa marca o categoría (el destino no es una llave foránea). */
export const contarEnPortada = (
  tx: Tx,
  tipo:
    typeof TIPOS_DESTINO_PORTADA.MARCA | typeof TIPOS_DESTINO_PORTADA.CATEGORIA,
  id: number,
) =>
  tx.slidePortada.count({ where: { tipoDestino: tipo, destino: String(id) } });

/**
 * Si entre el conteo y el borrado otra petición la empezó a usar, la llave foránea de la base
 * lo impide (P2003): se responde el mismo 409, sin el detalle.
 */
export const traducirUsoSimultaneo = (
  error: unknown,
  que: 'marca' | 'categoría',
): unknown =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2003'
    ? new ConflictException(
        `No se puede borrar: la ${que} se empezó a usar. Revisa dónde se usa antes de borrarla.`,
      )
    : error;
