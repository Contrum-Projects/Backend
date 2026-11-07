import { Prisma } from '../../generated/prisma/client.js';

type Monto = Prisma.Decimal | number;

/**
 * Subtotal neto de una línea de entrada: cantidad por costo unitario neto, con Decimal para no
 * arrastrar errores de coma flotante en los centavos (el costo es `Decimal(12, 2)`).
 */
export const subtotalNeto = (cantidad: number, costoUnitarioNeto: Monto) =>
  new Prisma.Decimal(costoUnitarioNeto).mul(cantidad);

/** Unidades y costo neto total de una entrada (E11-H2, SCRUM-150), sumados en el backend. */
export const totalesEntrada = (
  lineas: { cantidad: number; costoUnitarioNeto: Monto }[],
) => ({
  unidades: lineas.reduce((suma, linea) => suma + linea.cantidad, 0),
  costoNetoTotal: lineas
    .reduce(
      (suma, linea) =>
        suma.add(subtotalNeto(linea.cantidad, linea.costoUnitarioNeto)),
      new Prisma.Decimal(0),
    )
    .toNumber(),
});
