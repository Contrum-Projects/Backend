import { plainToInstance } from 'class-transformer';
import { getMetadataStorage, validate } from 'class-validator';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  erroresValidacion,
  errorValidacion,
  mensajesValidacion,
} from './mensajes-validacion.js';

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

describe('errores de validación por campo (SCRUM-150)', () => {
  const validar = async <T extends object>(
    clase: new () => T,
    entrada: object,
  ) =>
    validate(plainToInstance(clase, entrada), {
      forbidNonWhitelisted: true,
      whitelist: true,
    });

  it('SCRUM-150 · cada mensaje lleva la ruta de su campo, también en objetos y listas anidadas', async () => {
    const { ConfigurarCumpleanosDto } =
      await import('../../modulos/marketing/dto/configurar-cumpleanos.dto.js');
    const { CrearEntradaDto } =
      await import('../../modulos/inventario/dto/crear-entrada.dto.js');

    const saludo = erroresValidacion(
      await validar(ConfigurarCumpleanosDto, {
        activo: true,
        asunto: '',
        cuerpo: 'Hola',
        oferta: { activa: true },
      }),
    );
    expect(saludo.map(({ campo }) => campo)).toEqual(
      expect.arrayContaining(['asunto', 'oferta.texto']),
    );

    const entrada = erroresValidacion(
      await validar(CrearEntradaDto, {
        proveedorId: 1,
        fechaRecepcion: '2026-11-01',
        tipoDocumento: 'factura',
        numeroDocumento: '1',
        ubicacionId: 1,
        detalles: [{ formatoId: 1, cantidad: 0, costoUnitarioNeto: 100 }],
      }),
    );
    expect(entrada.map(({ campo }) => campo)).toContain('detalles.0.cantidad');
  });

  it('SCRUM-150 · un campo que no se admite lleva su propio nombre como campo', async () => {
    const { ConfigurarCumpleanosDto } =
      await import('../../modulos/marketing/dto/configurar-cumpleanos.dto.js');
    const errores = erroresValidacion(
      await validar(ConfigurarCumpleanosDto, {
        activo: true,
        asunto: 'A',
        cuerpo: 'B',
        oferta: { activa: false },
        descuento: 20,
      }),
    );
    expect(errores).toEqual([
      { campo: 'descuento', mensaje: 'El campo «descuento» no se admite.' },
    ]);
  });

  it('SCRUM-150 · el 400 conserva `message` como lista y agrega `errores`', () => {
    const error = errorValidacion([
      {
        property: 'email',
        constraints: { esCorreo: 'El correo no es válido.' },
        children: [],
      },
    ]);
    expect(error.getResponse()).toEqual({
      statusCode: 400,
      message: ['El correo no es válido.'],
      error: 'Bad Request',
      errores: [{ campo: 'email', mensaje: 'El correo no es válido.' }],
    });
  });
});
