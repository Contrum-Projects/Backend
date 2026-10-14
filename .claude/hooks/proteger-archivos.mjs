#!/usr/bin/env node
// Hook PreToolUse (Edit/Write): bloquea cambios a archivos que no se deben tocar a mano.
// Salida 2 = bloquear; el mensaje de stderr le explica a Claude qué hacer en su lugar.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

let entrada;
try {
  entrada = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

const archivo = entrada?.tool_input?.file_path;
if (!archivo) process.exit(0);

const raiz = process.env.CLAUDE_PROJECT_DIR || entrada.cwd || process.cwd();
const relativo = path.relative(raiz, path.resolve(raiz, archivo)).split(path.sep).join('/');
const nombre = path.basename(relativo);

function bloquear(motivo) {
  process.stderr.write(`Bloqueado: ${motivo}\n`);
  process.exit(2);
}

if (nombre.startsWith('.env') && nombre !== '.env.example') {
  bloquear(
    `${relativo} guarda credenciales (RNF-10). Agrega la variable en src/config/entorno.ts y en .env.example, y pide al usuario que complete su .env.`,
  );
}

if (relativo.startsWith('src/generated/')) {
  bloquear(`${relativo} lo genera Prisma. Cambia prisma/schema.prisma y corre pnpm db:generate.`);
}

if (
  /^prisma\/migrations\/[^/]+\/migration\.sql$/.test(relativo) &&
  existsSync(path.resolve(raiz, relativo))
) {
  bloquear(
    `${relativo} es una migración existente y no se edita. Cambia prisma/schema.prisma y crea una nueva con pnpm db:migrate --name <nombre>.`,
  );
}

if (relativo === 'pnpm-lock.yaml') {
  bloquear('pnpm-lock.yaml se actualiza con pnpm add/remove, no a mano.');
}

process.exit(0);
