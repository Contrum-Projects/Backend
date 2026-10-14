/**
 * Datos iniciales: las 16 regiones de Chile (código CUT) y una cuenta de
 * administrador para entrar al panel en desarrollo.
 *
 * Ejecutar: pnpm db:seed  (es idempotente: se puede correr varias veces)
 *
 * PENDIENTE: cargar las 346 comunas con su código CUT desde la fuente oficial
 * (lo cubre la historia de territorio / despacho).
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { ROLES } from '../src/common/dominio/roles.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const REGIONES: [string, string][] = [
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

async function main() {
  for (const [codigoCut, nombre] of REGIONES) {
    await prisma.region.upsert({
      where: { codigoCut },
      update: { nombre },
      create: { codigoCut, nombre },
    });
  }

  const email = (
    process.env.SEED_ADMIN_EMAIL ?? 'admin@cabelloperfecto.local'
  ).toLowerCase();
  const contrasena = process.env.SEED_ADMIN_PASSWORD ?? 'Cambiar.123456';
  await prisma.usuario.upsert({
    where: { email },
    update: {},
    create: {
      codigoPublico: randomUUID(),
      nombre: 'Administración',
      apellido: 'Cabello Perfecto',
      email,
      contrasenaHash: await argon2.hash(contrasena),
      rol: ROLES.ADMINISTRADOR,
      fechaVerificacionCorreo: new Date(),
    },
  });

  console.log(
    `Semilla lista: ${REGIONES.length} regiones y la cuenta ${email}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
