import { ESTADOS_PEDIDO } from '../../../common/dominio/valores.js';
import {
  escapar,
  fechaConHora,
  fechaCorta,
  fechaLarga,
  formatearPesos,
  rutasTienda,
} from './base.js';
import {
  correoConfirmacion,
  correoInvitacion,
  correoRecuperacion,
} from './cuenta.js';
import { correoCambioEstado, correoPagoConfirmado } from './pedido.js';
import { correoStockBajo, correoStockBajoRecuperado } from './stock-bajo.js';

const { pie: enlacesPie } = rutasTienda('https://tienda.cl/');
const ENLACE = 'https://tienda.cl/confirmar-correo?token=abc&x=1';
const FECHA = new Date('2026-10-11T20:05:00.000Z');

describe('Plantillas de correo', () => {
  it('E1-H6 · correo enviado: la confirmación lleva el texto del diseño, el enlace y el logo', () => {
    const { html, texto } = correoConfirmacion({
      asunto: 'Confirma tu correo',
      destinatario: 'camila@correo.cl',
      enlace: ENLACE,
      enlacesPie,
    });

    expect(html).toContain('Confirma tu correo');
    expect(html).toContain('Creaste una cuenta en Cabello Perfecto con');
    expect(html).toContain('Confirmar mi correo');
    expect(html).toContain(`href="${escapar(ENLACE)}"`);
    expect(html).toContain('cid:logo-cabello-perfecto');
    expect(html).toContain('https://tienda.cl/ayuda');
    expect(texto).toContain(ENLACE);
    expect(texto).not.toContain('<');
  });

  it('E1-H6 · la recuperación y la invitación avisan cuánto dura su enlace', () => {
    const base = { asunto: 'A', enlace: ENLACE, enlacesPie };

    expect(correoRecuperacion({ ...base, horas: 1 }).texto).toContain(
      'dura como máximo 1 hora.',
    );
    expect(
      correoInvitacion({ ...base, nombre: 'Ana', horas: 72 }).texto,
    ).toContain('dura como máximo 72 horas.');
  });

  it('E1-H6 · un dato de la persona no se interpreta como HTML', () => {
    const { html } = correoInvitacion({
      asunto: 'Te invitamos',
      nombre: '<img src=x onerror=alert(1)>',
      enlace: ENLACE,
      horas: 72,
      enlacesPie,
    });

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  describe('Pago confirmado', () => {
    const datos = {
      asunto: 'Recibimos tu pago · Pedido ABC',
      nombre: 'Camila',
      codigoPedido: 'ABC',
      lineas: [{ descripcion: 'Shampoo · 300 ml · 1 unidad', monto: 12990 }],
      despacho: { comuna: 'Ñuñoa', costo: 3990 },
      total: 16980,
      iva: 2711,
      entrega: 'Despacho a domicilio · Av. Ejemplo 1234, Ñuñoa',
      urlPedido: 'https://tienda.cl/mis-pedidos/ABC',
      enlacesPie,
    };

    it('E6-H2 · muestra productos, despacho, total e IVA, y no promete un adjunto', () => {
      const { html } = correoPagoConfirmado(datos);

      expect(html).toContain('$12.990');
      expect(html).toContain('Despacho a Ñuñoa');
      expect(html).toContain('$16.980');
      expect(html).toContain('IVA incluido: $2.711');
      expect(html).toContain(
        'Puedes descargar tu comprobante de pago desde el detalle del pedido.',
      );
      expect(html).not.toMatch(/adjunto|PDF/i);
    });

    it('E6-H2 · con retiro en tienda no habla de despacho', () => {
      const { html } = correoPagoConfirmado({
        ...datos,
        despacho: null,
        entrega: 'Retiro en tienda',
      });

      expect(html).toContain('cuando esté listo para retiro');
      expect(html).not.toContain('Despacho a');
    });
  });

  describe('Cambio de estado', () => {
    const datos = {
      asunto: 'Tu pedido ABC va en camino',
      nombre: 'Camila',
      codigoPedido: 'ABC',
      estado: ESTADOS_PEDIDO.DESPACHADO,
      fecha: FECHA,
      pasos: [
        { etiqueta: 'Pagado', fecha: '10 oct', situacion: 'hecho' as const },
        {
          etiqueta: 'Despachado',
          fecha: '11 oct',
          situacion: 'actual' as const,
        },
        { etiqueta: 'Entregado', fecha: null, situacion: 'futuro' as const },
      ],
      envio: {
        servicio: 'Chilexpress',
        codigoSeguimiento: '7891234560',
        direccion: 'Av. Ejemplo 1234, Ñuñoa',
      },
      urlPedido: 'https://tienda.cl/mis-pedidos/ABC',
      enlacesPie,
    };

    it('E8-H2 · despachado: título, fecha en hora de Chile, pasos y seguimiento', () => {
      const { html, texto } = correoCambioEstado(datos);

      expect(html).toContain('Tu pedido va en camino');
      expect(texto).toContain(
        'Despachamos tu pedido ABC el 11 de octubre a las 17:05.',
      );
      expect(html).toContain('7891234560');
      expect(html).toContain('Entregado');
    });

    it('E8-H2 · retiro: sin caja de envío', () => {
      const { html } = correoCambioEstado({
        ...datos,
        estado: ESTADOS_PEDIDO.LISTO_PARA_RETIRO,
        envio: null,
      });

      expect(html).toContain('Tu pedido está listo para retiro');
      expect(html).not.toContain('Chilexpress');
    });

    it('E8-H2 · sin código de seguimiento omite esa fila', () => {
      const { texto } = correoCambioEstado({
        ...datos,
        envio: { ...datos.envio, codigoSeguimiento: null },
      });

      expect(texto).not.toContain('Código de seguimiento');
    });

    it('E8-H2 · un estado sin aviso no arma un correo', () => {
      expect(() =>
        correoCambioEstado({ ...datos, estado: ESTADOS_PEDIDO.PAGADO }),
      ).toThrow('Estado sin correo');
    });
  });

  describe('Stock bajo', () => {
    const urlInventario = 'https://tienda.cl/panel/inventario';

    it('E11-H6 · muestra el stock total, el mínimo y la marca del panel', () => {
      const { html } = correoStockBajo({
        asunto: 'Stock bajo: Shampoo · 300 ml',
        formato: 'Shampoo · 300 ml',
        stockTotal: 2,
        stockMinimo: 5,
        filas: [{ etiqueta: 'SKU', valor: 'SH-300' }],
        urlInventario,
      });

      expect(html).toContain('Quedan 2 unidades en total. El mínimo es 5.');
      expect(html).toContain('Panel');
      expect(html).toContain('SH-300');
      expect(html).not.toContain('Términos y condiciones');
    });

    it('E11-H6 · reencolado: sin cifras, remite al inventario', () => {
      const { html } = correoStockBajoRecuperado({
        asunto: 'Stock bajo: Shampoo · 300 ml',
        urlInventario,
      });

      expect(html).toContain('Stock bajo: Shampoo · 300 ml');
      expect(html).toContain(urlInventario);
      expect(html).not.toContain('Quedan');
    });
  });

  it('E1-H6 · montos y fechas en formato de Chile', () => {
    expect(formatearPesos(28970)).toBe('$28.970');
    expect(fechaLarga(FECHA)).toBe('11 de octubre a las 17:05');
    expect(fechaCorta(FECHA)).toBe('11 oct');
    expect(fechaConHora(FECHA)).toBe('11 oct, 17:05');
  });
});
