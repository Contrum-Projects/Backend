/**
 * Regiones y comunas de la lista oficial (código CUT, decreto N° 1.115 de 2018). Las carga la
 * semilla y también las pruebas e2e que las necesitan, porque el CI no corre la semilla.
 * Es idempotente: se puede llamar varias veces.
 */
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { COMUNAS } from './comunas.js';

export const REGIONES: [string, string][] = [
  ['15', 'Arica y Parinacota'],
  ['01', 'Tarapacá'],
  ['02', 'Antofagasta'],
  ['03', 'Atacama'],
  ['04', 'Coquimbo'],
  ['05', 'Valparaíso'],
  ['13', 'Metropolitana de Santiago'],
  ['06', "Libertador General Bernardo O'Higgins"],
  ['07', 'Maule'],
  ['16', 'Ñuble'],
  ['08', 'Biobío'],
  ['09', 'La Araucanía'],
  ['14', 'Los Ríos'],
  ['10', 'Los Lagos'],
  ['11', 'Aysén del General Carlos Ibáñez del Campo'],
  ['12', 'Magallanes y de la Antártica Chilena'],
];

export async function cargarTerritorio(
  prisma: Pick<PrismaClient, 'region' | 'comuna'>,
): Promise<void> {
  for (const [codigoCut, nombre] of REGIONES) {
    await prisma.region.upsert({
      where: { codigoCut },
      update: { nombre },
      create: { codigoCut, nombre },
    });
  }

  const regiones = await prisma.region.findMany({
    select: { id: true, codigoCut: true },
  });
  const idRegion = new Map(regiones.map((r) => [r.codigoCut, r.id]));
  for (const [codigoCut, nombre] of COMUNAS) {
    // Los dos primeros dígitos del código de la comuna son los de su región
    const regionId = idRegion.get(codigoCut.slice(0, 2));
    if (!regionId) throw new Error(`La comuna ${codigoCut} no tiene región.`);
    await prisma.comuna.upsert({
      where: { codigoCut },
      update: { nombre, regionId },
      create: { codigoCut, nombre, regionId },
    });
  }
}
