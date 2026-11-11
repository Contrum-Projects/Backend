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
  correoRolProfesionalRetirado,
  correoVerificacionAprobada,
} from './cuenta.js';
import { correoCambioEstado, correoPagoConfirmado } from './pedido.js';
import { correoStockBajo, correoStockBajoRecuperado } from './stock-bajo.js';
import { correoConfirmacionSuscripcion } from './suscripcion.js';
import { correoCampana, parrafosDe } from './campana.js';

const { pie: enlacesPie } = rutasTienda('https://tienda.cl/');
const ENLACE = 'https://tienda.cl/confirmar-correo?token=abc&x=1';
const FECHA = new Date('2026-10-11T20:05:00.000Z');

describe('Plantillas de correo', () => {
  describe('Rutas de la tienda (SCRUM-150)', () => {
    it('SCRUM-150 · el enlace del pedido lleva a la página de la cuenta que existe en la tienda', () => {
      expect(rutasTienda('https://tienda.cl/').pedido('ABC 1')).toBe(
        'https://tienda.cl/cuenta/pedidos/ABC%201',
      );
    });

    it('SCRUM-150 · el pie no enlaza páginas que la tienda aún no tiene, y muestra solo las que sí', () => {
      expect(enlacesPie).toEqual({
        ayuda: null,
        terminos: null,
        privacidad: null,
      });
      const { html } = correoConfirmacion({
        asunto: 'A',
        destinatario: 'camila@correo.cl',
        enlace: ENLACE,
        enlacesPie: {
          ayuda: null,
          terminos: 'https://tienda.cl/terminos-y-condiciones',
          privacidad: null,
        },
      });
      expect(html).toContain('Términos y condiciones</a>');
      expect(html).not.toContain('Ayuda</a>');
      expect(html).not.toContain('Política de privacidad');
    });
  });

  describe('Campaña', () => {
    const BAJA = 'contacto@tienda.cl';

    it('E12-H3 · CA1 campaña enviada: el asunto es el título, el cuerpo va en párrafos y lleva remitente y baja (RNF-26)', () => {
      const { html, texto } = correoCampana({
        asunto: 'Nueva línea reparadora',
        cuerpo: 'Hola:\r\n\r\nLlegó la línea.\nEncuéntrala en la tienda.',
        correoBaja: BAJA,
        enlacesPie,
      });

      expect(html).toContain('Nueva línea reparadora');
      expect(html).toContain('Llegó la línea.<br>Encuéntrala en la tienda.');
      expect(html).toContain(
        `Para dejar de recibir ofertas, escríbenos a <a href="mailto:${BAJA}"`,
      );
      expect(texto).toContain('Hola:\n\nLlegó la línea.\nEncuéntrala');
      expect(texto).toContain(
        `Para dejar de recibir ofertas, escríbenos a ${BAJA}.`,
      );
    });

    it('E12-H3 · el cuerpo de la campaña es texto plano: el HTML no se interpreta', () => {
      const { html } = correoCampana({
        asunto: '<img src=x onerror=alert(1)>',
        cuerpo:
          '<script>alert(1)</script><a href="https://otro.sitio">aquí</a>',
        correoBaja: BAJA,
        enlacesPie,
      });

      expect(html).not.toContain('<script>');
      expect(html).not.toContain('<img src=x');
      expect(html).not.toContain('href="https://otro.sitio"');
      expect(html).toContain('&lt;script&gt;');
    });

    it('E12-H6 · CA1 apertura: con seguimiento, el correo lleva la imagen invisible; sin él, ninguna', () => {
      const datos = {
        asunto: 'Novedades',
        cuerpo: 'Hola.',
        correoBaja: BAJA,
        enlacesPie,
      };
      const conImagen = correoCampana({
        ...datos,
        seguimiento: 'https://api.tienda.cl/apertura/9.firma',
      });
      const sinImagen = correoCampana(datos);

      expect(conImagen.html).toContain(
        '<img src="https://api.tienda.cl/apertura/9.firma" width="1" height="1" alt=""',
      );
      expect(conImagen.texto).not.toContain('apertura');
      expect(sinImagen.html).not.toContain('width="1" height="1"');
    });

    it('E12-H3 · las líneas en blanco separan párrafos y los vacíos se descartan', () => {
      expect(parrafosDe('  uno \n\n\n dos\nsigue \n \n')).toEqual([
        'uno',
        'dos\nsigue',
      ]);
    });
  });

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
    expect(html).not.toContain('Ayuda</a>');
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
      urlPedido: 'https://tienda.cl/cuenta/pedidos/ABC',
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
      urlPedido: 'https://tienda.cl/cuenta/pedidos/ABC',
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

  it('E10-H4 · correo de aprobación: lleva el texto del diseño, el nombre y el enlace al catálogo, sin el mínimo de unidades', () => {
    const { catalogo } = rutasTienda('https://tienda.cl/');
    const { html, texto } = correoVerificacionAprobada({
      asunto: 'Tu cuenta profesional está activa',
      nombre: 'Andrea',
      urlCatalogo: catalogo,
      enlacesPie,
    });

    expect(catalogo).toBe('https://tienda.cl/catalogo');
    expect(html).toContain('Tu cuenta profesional está activa');
    expect(html).toContain('Hola, Andrea. Aprobamos tu verificación.');
    expect(html).toContain('Ver precios profesionales');
    expect(html).toContain('href="https://tienda.cl/catalogo"');
    expect(html).toContain('pediste verificar tu cuenta como profesional');
    expect(html).not.toContain('3 unidades');
    expect(texto).toContain(
      'Ver precios profesionales: https://tienda.cl/catalogo',
    );
    expect(texto).not.toContain('<');
  });

  it('E10-H4 · correo de aprobación: el nombre no se interpreta como HTML', () => {
    const { html } = correoVerificacionAprobada({
      asunto: 'A',
      nombre: '<b>Andrea</b>',
      urlCatalogo: 'https://tienda.cl/catalogo',
      enlacesPie,
    });

    expect(html).not.toContain('<b>Andrea</b>');
    expect(html).toContain('&lt;b&gt;Andrea&lt;/b&gt;');
  });

  it('E12-H1 · solicitud de suscripción: el correo pide confirmar, lleva el enlace y su vigencia', () => {
    const enlace = 'https://tienda.cl/suscripcion/confirmar?token=a.b.c.d';
    const { html, texto } = correoConfirmacionSuscripcion({
      asunto: 'Confirma tu suscripción a las ofertas',
      destinatario: 'visita@correo.cl',
      enlace,
      horas: 24,
      enlacesPie,
    });

    expect(html).toContain('Confirma tu suscripción');
    expect(html).toContain('visita@correo.cl');
    expect(html).toContain('Confirmar mi suscripción');
    expect(html).toContain(`href="${escapar(enlace)}"`);
    expect(html).toContain('24 horas');
    expect(texto).toContain(enlace);
    expect(texto).not.toContain('<');
  });

  it('E13-H3 · profesional que vuelve a cliente: el correo lleva el motivo, el precio normal y que sus pedidos no cambian', () => {
    const { html, texto } = correoRolProfesionalRetirado({
      asunto: 'Tu cuenta volvió a ser de cliente',
      nombre: 'Andrea',
      motivo: 'Dejaste de ejercer como peluquera según nos informaste.',
      urlCatalogo: 'https://tienda.cl/catalogo',
      enlacesPie,
    });

    expect(html).toContain('Tu cuenta volvió a ser de cliente');
    expect(html).toContain('Hola, Andrea.');
    expect(html).toContain('compras a precio normal');
    expect(html).toContain('productos exclusivos');
    expect(html).toContain('Tus pedidos anteriores no cambian.');
    expect(html).toContain(
      'Dejaste de ejercer como peluquera según nos informaste.',
    );
    expect(html).toContain('href="https://tienda.cl/catalogo"');
    expect(texto).toContain(
      'Motivo: Dejaste de ejercer como peluquera según nos informaste.',
    );
    expect(texto).not.toContain('<');
  });

  it('E13-H3 · el motivo y el nombre del correo no se interpretan como HTML', () => {
    const { html } = correoRolProfesionalRetirado({
      asunto: 'A',
      nombre: '<b>Andrea</b>',
      motivo: '<script>alert(1)</script> motivo',
      urlCatalogo: 'https://tienda.cl/catalogo',
      enlacesPie,
    });

    expect(html).not.toContain('<b>Andrea</b>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; motivo');
  });
});
