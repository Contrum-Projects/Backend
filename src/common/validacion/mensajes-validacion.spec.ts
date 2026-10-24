import { plainToInstance } from 'class-transformer';
import { getMetadataStorage, validate } from 'class-validator';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mensajesValidacion } from './mensajes-validacion.js';

const MODULOS = join(import.meta.dirname, '..', '..', 'modulos');

/** Todos los DTOs de `src/modulos/<modulo>/dto/*.dto.ts`. */
const cargarDtos = async () => {
  const clases: [string, new () => object][] = [];
  for (const modulo of readdirSync(MODULOS, { withFileTypes: true })) {
    if (!modulo.isDirectory()) continue;
    const carpeta = join(MODULOS, modulo.name, 'dto');
    let archivos: string[] = [];
    try {
      archivos = readdirSync(carpeta).filter((a) => a.endsWith('.dto.ts'));
    } catch {
      continue;
    }
    for (const archivo of archivos) {
      const exportado = (await import(
        pathToFileURL(join(carpeta, archivo)).href
      )) as Record<string, unknown>;
      for (const [nombre, valor] of Object.entries(exportado)) {
        if (typeof valor === 'function') {
          clases.push([nombre, valor as new () => object]);
        }
      }
    }
  }
  return clases;
};

/** Valores que rompen cualquier regla: faltante, otro tipo, demasiado largo, negativo, etc. */
const VALORES_INVALIDOS: unknown[] = [
  undefined,
  null,
  12_345,
  -1,
  1.5,
  '',
  'x'.repeat(6_000),
  '\u0000',
  [],
  {},
  true,
];

/** class-validator escribe sus mensajes por defecto en inglés: «x must be a string». */
const EN_INGLES = /\b(must|should|property|each value)\b/i;

describe('mensajes de validación', () => {
  // Importa y valida todos los DTOs: tarda más que una prueba común (plazo de 30 s)
  it('ningún DTO responde un mensaje en inglés, con ningún valor', async () => {
    const dtos = await cargarDtos();
    expect(dtos.length).toBeGreaterThan(10);

    for (const [nombre, clase] of dtos) {
      const campos = new Set(
        getMetadataStorage()
          .getTargetValidationMetadatas(clase, '', true, false)
          .map((m) => m.propertyName),
      );
      for (const campo of campos) {
        for (const valor of VALORES_INVALIDOS) {
          const errores = await validate(
            plainToInstance(clase, { [campo]: valor, sobra: 1 }),
            { whitelist: true, forbidNonWhitelisted: true },
          );
          for (const mensaje of mensajesValidacion(errores)) {
            expect(
              mensaje,
              `${nombre}.${campo} = ${String(valor)}`,
            ).not.toMatch(EN_INGLES);
          }
        }
      }
    }
  }, 30_000);

  it('un campo que no está en el DTO se informa en español', () => {
    expect(
      mensajesValidacion([
        {
          property: 'sobra',
          constraints: {
            whitelistValidation: 'property sobra should not exist',
          },
          children: [],
        },
      ]),
    ).toEqual(['El campo «sobra» no se admite.']);
  });
});
