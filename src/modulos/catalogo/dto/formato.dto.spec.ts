import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ActualizarFormatoDto } from './actualizar-formato.dto.js';
import { CrearFormatoDto } from './crear-formato.dto.js';

const errores = async <T extends object>(clase: new () => T, datos: object) =>
  (await validate(plainToInstance(clase, datos))).map((e) => e.property).sort();

const mensajes = async <T extends object>(clase: new () => T, datos: object) =>
  (await validate(plainToInstance(clase, datos))).flatMap((e) =>
    Object.values(e.constraints ?? {}),
  );

const validos = (extra: object = {}) => ({
  sku: 'SHA-REP-300',
  codigoBarras: '7801234567890',
  nombreFormato: '300 ml',
  contenido: 300,
  unidadMedida: 'ml',
  stockMinimo: 5,
  pesoGramos: 320,
  altoCm: 18.5,
  anchoCm: 6,
  largoCm: 4.25,
  ...extra,
});

describe('DTOs de formatos', () => {
  describe('CrearFormatoDto', () => {
    it('E3-H2 · formato creado: acepta los datos completos y también sin los opcionales', async () => {
      expect(await errores(CrearFormatoDto, validos())).toEqual([]);
      expect(
        await errores(CrearFormatoDto, {
          sku: 'X1',
          nombreFormato: 'Unidad',
          pesoGramos: 1,
          altoCm: 1,
          anchoCm: 1,
          largoCm: 1,
        }),
      ).toEqual([]);
    });

    it('E3-H2 · datos obligatorios faltantes: nombra cada campo en español', async () => {
      expect(await errores(CrearFormatoDto, {})).toEqual([
        'altoCm',
        'anchoCm',
        'largoCm',
        'nombreFormato',
        'pesoGramos',
        'sku',
      ]);
      expect(await mensajes(CrearFormatoDto, {})).toContain(
        'El SKU es obligatorio.',
      );
    });

    it('E3-H2 · SKU con espacios, caracteres invisibles, tildes o de más de 50 caracteres: lo rechaza', async () => {
      for (const sku of ['SHA REP', 'SHA-REP​', 'CAÑA-1']) {
        expect(await errores(CrearFormatoDto, validos({ sku }))).toEqual([
          'sku',
        ]);
      }
      expect(
        await errores(CrearFormatoDto, validos({ sku: 'A'.repeat(51) })),
      ).toEqual(['sku']);
    });

    it('E3-H2 · código de barras: solo 8, 12, 13 o 14 dígitos; vacío equivale a no enviarlo', async () => {
      for (const codigo of ['12345678', '123456789012', '12345678901234']) {
        expect(
          await errores(CrearFormatoDto, validos({ codigoBarras: codigo })),
        ).toEqual([]);
      }
      for (const codigo of ['1234567', '123456789', '78012345678AB', 7801234]) {
        expect(
          await errores(CrearFormatoDto, validos({ codigoBarras: codigo })),
        ).toEqual(['codigoBarras']);
      }
      const dto = plainToInstance(
        CrearFormatoDto,
        validos({ codigoBarras: '  ' }),
      );
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.codigoBarras).toBeNull();
    });

    it('E3-H2 · medidas y peso: positivos, con hasta dos decimales en las medidas y entero en el peso', async () => {
      expect(
        await errores(
          CrearFormatoDto,
          validos({ altoCm: 0, anchoCm: 1.234, largoCm: '4', pesoGramos: 1.5 }),
        ),
      ).toEqual(['altoCm', 'anchoCm', 'largoCm', 'pesoGramos']);
      expect(
        await errores(CrearFormatoDto, validos({ altoCm: 100_000 })),
      ).toEqual(['altoCm']);
    });

    it('E3-H2 · stock mínimo: entero desde 0', async () => {
      expect(
        await errores(CrearFormatoDto, validos({ stockMinimo: 0 })),
      ).toEqual([]);
      expect(
        await errores(CrearFormatoDto, validos({ stockMinimo: -1 })),
      ).toEqual(['stockMinimo']);
    });

    it('E3-H2 · unidad de medida: solo ml, g o unidades', async () => {
      expect(
        await errores(CrearFormatoDto, validos({ unidadMedida: 'unidades' })),
      ).toEqual([]);
      expect(
        await errores(CrearFormatoDto, validos({ unidadMedida: 'litros' })),
      ).toEqual(['unidadMedida']);
    });

    it('E3-H2 · fecha de vencimiento opcional: acepta AAAA-MM-DD real y rechaza otras', async () => {
      expect(
        await errores(
          CrearFormatoDto,
          validos({ fechaVencimiento: '2028-02-29' }),
        ),
      ).toEqual([]);
      for (const fecha of [
        '2027-02-30',
        '31-12-2027',
        '2027-12-31T00:00:00Z',
      ]) {
        expect(
          await errores(CrearFormatoDto, validos({ fechaVencimiento: fecha })),
        ).toEqual(['fechaVencimiento']);
      }
    });
  });

  describe('ActualizarFormatoDto', () => {
    it('acepta un cuerpo parcial y null en los datos opcionales', async () => {
      expect(
        await errores(ActualizarFormatoDto, {
          nombreFormato: '500 ml',
          codigoBarras: null,
          contenido: null,
          unidadMedida: null,
          fechaVencimiento: null,
        }),
      ).toEqual([]);
    });

    it('rechaza null en los datos obligatorios', async () => {
      expect(
        await errores(ActualizarFormatoDto, {
          sku: null,
          nombreFormato: null,
          pesoGramos: null,
        }),
      ).toEqual(['nombreFormato', 'pesoGramos', 'sku']);
    });
  });
});
