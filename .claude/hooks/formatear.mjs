#!/usr/bin/env node
// Hook PostToolUse (Edit/Write): formatea con Prettier el archivo TypeScript recién editado.
// Nunca bloquea: si Prettier falla, solo avisa.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

let entrada;
try {
  entrada = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

const archivo = entrada?.tool_input?.file_path;
if (!archivo || !/\.(ts|mts|cts)$/.test(archivo)) process.exit(0);

const raiz = process.env.CLAUDE_PROJECT_DIR || entrada.cwd || process.cwd();
if (path.relative(raiz, path.resolve(raiz, archivo)).startsWith('src/generated')) {
  process.exit(0);
}

const resultado = spawnSync('pnpm', ['exec', 'prettier', '--write', archivo], {
  cwd: raiz,
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

if (resultado.status !== 0) {
  process.stderr.write(`Prettier no pudo formatear ${archivo}\n`);
  process.exit(1);
}
process.exit(0);
