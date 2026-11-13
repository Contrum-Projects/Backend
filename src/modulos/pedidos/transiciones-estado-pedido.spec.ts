import { ESTADOS_PEDIDO } from '../../common/dominio/valores.js';
import {
  cambiosPermitidos,
  ESTADOS_CON_AVISO,
  ETIQUETAS_ESTADO,
  sentidoDelCambio,
} from './transiciones-estado-pedido.js';

describe('transiciones de estado del pedido', () => {
  it('E8-H2 · avanzar: pagado → en preparación → despachado → entregado (despacho)', () => {
    expect(sentidoDelCambio('pagado', 'en_preparacion', 'despacho')).toBe(
      'avance',
    );
    expect(sentidoDelCambio('en_preparacion', 'despachado', 'despacho')).toBe(
      'avance',
    );
    expect(sentidoDelCambio('despachado', 'entregado', 'despacho')).toBe(
      'avance',
    );
  });

  it('E8-H2 · avanzar un retiro en tienda: en preparación → listo para retiro → retirado', () => {
    expect(
      sentidoDelCambio('en_preparacion', 'listo_para_retiro', 'retiro'),
    ).toBe('avance');
    expect(sentidoDelCambio('listo_para_retiro', 'retirado', 'retiro')).toBe(
      'avance',
    );
  });

  it('un estado que no corresponde a la forma de entrega no es un cambio permitido', () => {
    expect(
      sentidoDelCambio('en_preparacion', 'listo_para_retiro', 'despacho'),
    ).toBeNull();
    expect(
      sentidoDelCambio('en_preparacion', 'despachado', 'retiro'),
    ).toBeNull();
  });

  it('volver atrás: de a un paso, por el mismo camino', () => {
    expect(sentidoDelCambio('en_preparacion', 'pagado', 'despacho')).toBe(
      'retroceso',
    );
    expect(sentidoDelCambio('despachado', 'en_preparacion', 'despacho')).toBe(
      'retroceso',
    );
    expect(sentidoDelCambio('entregado', 'despachado', 'despacho')).toBe(
      'retroceso',
    );
    expect(
      sentidoDelCambio('listo_para_retiro', 'en_preparacion', 'retiro'),
    ).toBe('retroceso');
    expect(sentidoDelCambio('retirado', 'listo_para_retiro', 'retiro')).toBe(
      'retroceso',
    );
  });

  it('no permite saltarse pasos, repetir el estado, tocar el pago ni la cancelación', () => {
    expect(sentidoDelCambio('pagado', 'despachado', 'despacho')).toBeNull();
    expect(sentidoDelCambio('despachado', 'despachado', 'despacho')).toBeNull();
    expect(
      sentidoDelCambio('entregado', 'en_preparacion', 'despacho'),
    ).toBeNull();
    expect(sentidoDelCambio('pendiente_pago', 'pagado', 'despacho')).toBeNull();
    expect(sentidoDelCambio('pagado', 'pendiente_pago', 'despacho')).toBeNull();
    expect(sentidoDelCambio('pagado', 'cancelado', 'despacho')).toBeNull();
    expect(sentidoDelCambio('cancelado', 'pagado', 'despacho')).toBeNull();
    expect(sentidoDelCambio('entregado', 'x', 'despacho')).toBeNull();
  });

  it('E8-H2 · avisa solo los cambios clave: despachado, listo para retiro, entregado y retirado', () => {
    expect([...ESTADOS_CON_AVISO].sort()).toEqual(
      ['despachado', 'entregado', 'listo_para_retiro', 'retirado'].sort(),
    );
    expect(ESTADOS_CON_AVISO).not.toContain('en_preparacion');
  });

  it('cada estado tiene un nombre para mostrar', () => {
    expect(Object.keys(ETIQUETAS_ESTADO).sort()).toEqual(
      Object.values(ESTADOS_PEDIDO).sort(),
    );
  });
});

describe('cambiosPermitidos (SCRUM-150)', () => {
  it('E8-H2 · ofrece la misma secuencia que valida el cambio, con lo que pide cada uno', () => {
    expect(cambiosPermitidos('en_preparacion', 'despacho')).toEqual([
      {
        estado: 'despachado',
        sentido: 'avance',
        pideCodigoSeguimiento: true,
        creaOt: false,
        avisaAlCliente: true,
        pideComentario: false,
      },
      {
        estado: 'pagado',
        sentido: 'retroceso',
        pideCodigoSeguimiento: false,
        creaOt: false,
        avisaAlCliente: false,
        pideComentario: true,
      },
    ]);
    // Pagado solo avanza, y en preparación no avisa
    expect(cambiosPermitidos('pagado', 'retiro')).toEqual([
      {
        estado: 'en_preparacion',
        sentido: 'avance',
        pideCodigoSeguimiento: false,
        creaOt: false,
        avisaAlCliente: false,
        pideComentario: false,
      },
    ]);
  });

  it('SCRUM-153 · con la OT automática configurada, despachar indica que la OT se crea sola', () => {
    const [despachar, volver] = cambiosPermitidos(
      'en_preparacion',
      'despacho',
      true,
    );
    expect(despachar).toMatchObject({ estado: 'despachado', creaOt: true });
    expect(volver).toMatchObject({ estado: 'pagado', creaOt: false });
    expect(
      cambiosPermitidos('en_preparacion', 'retiro', true)[0],
    ).toMatchObject({
      estado: 'listo_para_retiro',
      creaOt: false,
    });
  });

  it('E8-H2 · cada cambio ofrecido es uno que sentidoDelCambio acepta; sin cambios en pendiente de pago ni cancelado', () => {
    for (const actual of Object.values(ESTADOS_PEDIDO)) {
      for (const entrega of ['despacho', 'retiro']) {
        for (const cambio of cambiosPermitidos(actual, entrega)) {
          expect(sentidoDelCambio(actual, cambio.estado, entrega)).toBe(
            cambio.sentido,
          );
        }
      }
    }
    expect(cambiosPermitidos('pendiente_pago', 'retiro')).toEqual([]);
    expect(cambiosPermitidos('cancelado', 'despacho')).toEqual([]);
  });
});
