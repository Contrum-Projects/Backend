import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CANALES_VENTA } from '../../../common/dominio/valores.js';
import { CanalVenta } from './canal-venta.decorator.js';

class Obligatorio {
  @CanalVenta()
  canalVenta: unknown;
}

class PuedeFaltar {
  @CanalVenta({ puedeFaltar: true })
  canalVenta?: unknown;
}

const mensajes = <T extends object>(clase: new () => T, datos: object) =>
  validateSync(plainToInstance(clase, datos)).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );

describe('CanalVenta', () => {
  it('acepta cada canal definido por el equipo, también con espacios alrededor', () => {
    for (const canal of Object.values(CANALES_VENTA)) {
      expect(mensajes(Obligatorio, { canalVenta: canal })).toEqual([]);
      expect(mensajes(Obligatorio, { canalVenta: ` ${canal} ` })).toEqual([]);
    }
  });

  it('un canal que falta, null o vacío da el mensaje de «obligatorio»', () => {
    for (const canalVenta of [undefined, null, '', '   ']) {
      expect(mensajes(Obligatorio, { canalVenta })).toEqual([
        'El canal de venta es obligatorio.',
      ]);
    }
  });

  it('un valor que no es un canal dice cuáles hay', () => {
    for (const canalVenta of ['mayorista', 'General', 7]) {
      expect(mensajes(Obligatorio, { canalVenta })).toEqual([
        'El canal de venta debe ser uno de estos: general, profesional.',
      ]);
    }
  });

  it('con puedeFaltar, la ausencia es válida pero null o un valor malo no', () => {
    expect(mensajes(PuedeFaltar, {})).toEqual([]);
    expect(mensajes(PuedeFaltar, { canalVenta: 'profesional' })).toEqual([]);
    expect(mensajes(PuedeFaltar, { canalVenta: null })).toEqual([
      'El canal de venta es obligatorio.',
    ]);
    expect(mensajes(PuedeFaltar, { canalVenta: 'otro' })).toHaveLength(1);
  });
});
