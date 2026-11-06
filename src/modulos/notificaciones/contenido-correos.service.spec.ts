import type { ConfigService } from '@nestjs/config';
import { TRABAJOS_CORREO } from '../../colas/colas.js';
import { ROLES } from '../../common/dominio/roles.js';
import type { Entorno } from '../../config/entorno.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CarritoService } from '../carrito/carrito.service.js';
import type { FirmaBaja } from '../marketing/firma-baja.js';
import type { FirmaSeguimiento } from '../marketing/firma-seguimiento.js';
import { ContenidoCorreosService } from './contenido-correos.service.js';

const MOTIVO = 'Dejó de ejercer como peluquera según nos informó.';

describe('ContenidoCorreosService', () => {
  const crear = () => {
    const prisma = {
      historialRol: {
        findFirstOrThrow: vi.fn().mockResolvedValue({ motivo: MOTIVO }),
      },
      itemCarrito: { findMany: vi.fn().mockResolvedValue([]) },
      campana: {
        findUnique: vi.fn().mockResolvedValue({
          cuerpo: 'Llegó la línea reparadora.\n\n<b>Solo</b> esta semana.',
        }),
        // Saludo de cumpleaños configurado, con la oferta activa (E12-H5)
        findFirst: vi.fn().mockResolvedValue({
          cuerpo: 'Te deseamos un gran día.',
          segmento: JSON.stringify({
            oferta: { activa: true, texto: '20 % en <b>toda</b> la tienda' },
          }),
        }),
      },
      carrito: {
        findUnique: vi.fn().mockResolvedValue({ usuario: { rol: 'cliente' } }),
      },
    };
    // Por defecto, todo lo del carrito sigue a la venta para la cuenta
    const carritoService = {
      articulosALaVenta: vi.fn(
        (_cliente: unknown, ids: number[]) =>
          new Map(ids.map((id) => [id, { tipo: 'formato' }])),
      ),
    };
    const config = {
      get: () => 'https://tienda.cl/',
    } as unknown as ConfigService<Entorno, true>;
    const firmaBaja = {
      enlace: vi.fn(
        (email: string) =>
          `https://tienda.cl/suscripcion/baja?token=firma-${email}`,
      ),
    };
    // Por defecto, sin URL_API: sin imagen de apertura y con los enlaces tal cual
    const seguimiento = {
      enlaceApertura: vi.fn((): string | null => null),
      enlaceClic: vi.fn((_id: number, destino: string) => destino),
    };
    return {
      prisma,
      firmaBaja,
      carritoService,
      seguimiento,
      servicio: new ContenidoCorreosService(
        prisma as unknown as PrismaService,
        config,
        firmaBaja as unknown as FirmaBaja,
        carritoService as unknown as CarritoService,
        seguimiento as unknown as FirmaSeguimiento,
      ),
    };
  };

  it('E12-H3 · CA1 campaña enviada: el correo lleva el cuerpo de la campaña leído al enviar y el enlace de baja de esa dirección', async () => {
    const { servicio, prisma, firmaBaja } = crear();

    const { html, texto } = await servicio.construir(
      TRABAJOS_CORREO.CAMPANA,
      { notificacionId: 9, destinatario: 'camila@correo.cl' },
      { asunto: 'Novedades', pedidoId: null, campanaId: 4 },
    );

    expect(prisma.campana.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 4 } }),
    );
    expect(firmaBaja.enlace).toHaveBeenCalledWith('camila@correo.cl');
    expect(html).toContain('Llegó la línea reparadora.');
    expect(html).toContain('&lt;b&gt;Solo&lt;/b&gt;');
    expect(html).toContain('firma-camila@correo.cl');
    expect(texto).toContain('Dejar de recibir ofertas');
  });

  it('E12-H3 · un correo de campaña cuya campaña no existe falla y queda para los reintentos', async () => {
    const { servicio, prisma } = crear();
    prisma.campana.findUnique.mockResolvedValue(null);

    await expect(
      servicio.construir(
        TRABAJOS_CORREO.CAMPANA,
        { notificacionId: 9, destinatario: 'camila@correo.cl' },
        { asunto: 'Novedades', pedidoId: null, campanaId: 4 },
      ),
    ).rejects.toThrow();
  });

  let siguienteArticulo = 1;

  /** Una línea del carrito como la devuelve Prisma. */
  const formato = (producto: string, nombreFormato: string, cantidad = 1) => ({
    articuloId: siguienteArticulo++,
    cantidad,
    articulo: {
      formato: { nombreFormato, producto: { nombre: producto } },
      pack: null,
    },
  });

  it('E12-H4 · CA1 serie de recordatorios: el correo nombra los artículos del carrito con su cantidad, sin precios, y lleva el enlace de baja', async () => {
    const { prisma, firmaBaja, servicio } = crear();
    prisma.itemCarrito.findMany.mockResolvedValue([
      formato('Shampoo Reparador', '300 ml', 2),
      {
        articuloId: 999,
        cantidad: 1,
        articulo: { formato: null, pack: { nombre: 'Dúo Hidratación' } },
      },
    ]);

    const { html, texto } = await servicio.construir(
      TRABAJOS_CORREO.RECORDATORIO_CARRITO,
      {
        notificacionId: 12,
        destinatario: 'camila@correo.cl',
        nombre: 'Camila',
      },
      { asunto: 'Tus productos te esperan', pedidoId: null, usuarioId: 20 },
    );

    expect(prisma.itemCarrito.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { carrito: { usuarioId: 20 } } }),
    );
    expect(firmaBaja.enlace).toHaveBeenCalledWith('camila@correo.cl');
    expect(html).toContain('Hola, Camila.');
    expect(html).toContain('Shampoo Reparador · 300 ml');
    expect(html).toContain('2 unidades');
    expect(html).toContain('Dúo Hidratación');
    expect(html).toContain('https://tienda.cl/carrito');
    expect(html).toContain(
      'https://tienda.cl/suscripcion/baja?token=firma-camila@correo.cl',
    );
    expect(html).toContain('Dejar de recibir ofertas');
    expect(html).not.toMatch(/\$\d/);
    expect(texto).toContain('- Shampoo Reparador · 300 ml: 2 unidades');
    expect(texto).toContain(
      'Dejar de recibir ofertas: https://tienda.cl/suscripcion/baja?token=firma-camila@correo.cl',
    );
  });

  it('E12-H4 · RNF-04 · el correo no nombra artículos que ya no están a la venta para la cuenta, como un producto que pasó a exclusivo', async () => {
    const { prisma, carritoService, servicio } = crear();
    const general = formato('Shampoo General', '300 ml');
    const exclusivo = formato('Tinte Profesional', '60 ml');
    prisma.itemCarrito.findMany.mockResolvedValue([general, exclusivo]);
    carritoService.articulosALaVenta.mockResolvedValue(
      new Map([[general.articuloId, { tipo: 'formato' }]]),
    );

    const { html, texto } = await servicio.construir(
      TRABAJOS_CORREO.RECORDATORIO_CARRITO,
      {
        notificacionId: 12,
        destinatario: 'camila@correo.cl',
        nombre: 'Camila',
      },
      { asunto: 'Tus productos te esperan', pedidoId: null, usuarioId: 20 },
    );

    expect(carritoService.articulosALaVenta).toHaveBeenCalledWith(
      prisma,
      [general.articuloId, exclusivo.articuloId],
      'cliente',
    );
    expect(html).toContain('Shampoo General');
    expect(html).not.toContain('Tinte Profesional');
    expect(texto).not.toContain('Tinte Profesional');
  });

  it('E12-H4 · CA1 serie de recordatorios: con muchos artículos nombra los primeros cinco y dice cuántos más hay', async () => {
    const { prisma, servicio } = crear();
    prisma.itemCarrito.findMany.mockResolvedValue(
      Array.from({ length: 7 }, (_, i) => formato(`Producto ${i + 1}`, '1 L')),
    );

    const { html, texto } = await servicio.construir(
      TRABAJOS_CORREO.RECORDATORIO_CARRITO,
      {
        notificacionId: 12,
        destinatario: 'camila@correo.cl',
        nombre: 'Camila',
      },
      { asunto: 'Tus productos te esperan', pedidoId: null, usuarioId: 20 },
    );

    expect(html).toContain('Producto 5 · 1 L');
    expect(html).not.toContain('Producto 6');
    expect(texto).toContain('Y 2 artículos más.');
  });

  const CUMPLEANOS = {
    notificacionId: 30,
    destinatario: 'camila@correo.cl',
    nombre: 'Camila',
  };
  const NOTIFICACION_CUMPLEANOS = {
    asunto: '¡Feliz cumpleaños!',
    pedidoId: null,
    usuarioId: 20,
    campanaId: 4,
  };

  it('E12-H5 · CA2 saludo con oferta: con la oferta activa al enviar, el correo la incluye escapada, con el saludo y el enlace de baja', async () => {
    const { servicio, prisma, firmaBaja } = crear();

    const { html, texto } = await servicio.construir(
      TRABAJOS_CORREO.CUMPLEANOS,
      CUMPLEANOS,
      NOTIFICACION_CUMPLEANOS,
    );

    expect(prisma.campana.findFirst).toHaveBeenCalledWith({
      where: { tipo: 'cumpleanos' },
      orderBy: { id: 'asc' },
      select: { cuerpo: true, segmento: true },
    });
    expect(html).toContain('Hola, Camila:');
    expect(html).toContain('Te deseamos un gran día.');
    expect(html).toContain('Tu regalo de cumpleaños');
    expect(html).toContain('20 % en &lt;b&gt;toda&lt;/b&gt; la tienda');
    expect(html).not.toContain('<b>toda</b>');
    expect(texto).toContain(
      'Tu regalo de cumpleaños: 20 % en <b>toda</b> la tienda',
    );
    expect(firmaBaja.enlace).toHaveBeenCalledWith('camila@correo.cl');
    expect(texto).toContain('firma-camila@correo.cl');
  });

  it('E12-H5 · CA2 saludo con oferta: con la oferta desactivada, el correo sale sin ella', async () => {
    const { servicio, prisma } = crear();
    prisma.campana.findFirst.mockResolvedValue({
      cuerpo: 'Te deseamos un gran día.',
      segmento: JSON.stringify({
        oferta: { activa: false, texto: '20 % en toda la tienda' },
      }),
    });

    const { html, texto } = await servicio.construir(
      TRABAJOS_CORREO.CUMPLEANOS,
      CUMPLEANOS,
      NOTIFICACION_CUMPLEANOS,
    );

    expect(html).toContain('Te deseamos un gran día.');
    expect(html).not.toContain('Tu regalo de cumpleaños');
    expect(texto).not.toContain('20 % en toda la tienda');
  });

  it('E12-H5 · CA1 saludo enviado: sin configurar, sale el saludo por defecto y sin oferta', async () => {
    const { servicio, prisma } = crear();
    prisma.campana.findFirst.mockResolvedValue(null);

    const { html } = await servicio.construir(
      TRABAJOS_CORREO.CUMPLEANOS,
      CUMPLEANOS,
      { ...NOTIFICACION_CUMPLEANOS, campanaId: null },
    );

    expect(html).toContain('queremos desearte un muy feliz cumpleaños');
    expect(html).not.toContain('Tu regalo de cumpleaños');
  });

  it('E13-H3 · profesional que vuelve a cliente: el correo lleva el motivo del último cambio de profesional a cliente de esa cuenta', async () => {
    const { prisma, servicio } = crear();

    const { html, texto } = await servicio.construir(
      TRABAJOS_CORREO.ROL_PROFESIONAL_RETIRADO,
      { notificacionId: 9, destinatario: 'andrea@correo.cl', nombre: 'Andrea' },
      {
        asunto: 'Tu cuenta volvió a ser de cliente',
        pedidoId: null,
        usuarioId: 20,
      },
    );

    expect(prisma.historialRol.findFirstOrThrow).toHaveBeenCalledWith({
      where: {
        usuarioId: 20,
        rolAnterior: ROLES.PROFESIONAL,
        rolNuevo: ROLES.CLIENTE,
      },
      select: { motivo: true },
      orderBy: { id: 'desc' },
    });
    expect(html).toContain(MOTIVO);
    expect(html).toContain('Hola, Andrea.');
    expect(texto).toContain(`Motivo: ${MOTIVO}`);
    expect(texto).toContain('https://tienda.cl/catalogo');
  });

  describe('E12-H6 · seguimiento de la publicidad', () => {
    const conSeguimiento = () => {
      const creado = crear();
      creado.seguimiento.enlaceApertura.mockImplementation(
        () => 'https://api.tienda.cl/apertura/9',
      );
      creado.seguimiento.enlaceClic.mockImplementation(
        (id: number, destino: string) =>
          `https://api.tienda.cl/clic/${id}?destino=${destino}`,
      );
      return creado;
    };

    it('E12-H6 · CA1 apertura y clic: la campaña lleva la imagen de apertura de su notificación y sus enlaces pasan por el seguimiento, menos el de baja', async () => {
      const { servicio, seguimiento } = conSeguimiento();

      const { html, texto } = await servicio.construir(
        TRABAJOS_CORREO.CAMPANA,
        { notificacionId: 9, destinatario: 'camila@correo.cl' },
        { asunto: 'Novedades', pedidoId: null, campanaId: 4 },
      );

      expect(seguimiento.enlaceApertura).toHaveBeenCalledWith(9);
      expect(html).toContain('<img src="https://api.tienda.cl/apertura/9"');
      expect(html).toContain(
        'https://api.tienda.cl/clic/9?destino=https://tienda.cl/privacidad',
      );
      expect(html).toContain(
        'href="https://tienda.cl/suscripcion/baja?token=firma-camila@correo.cl"',
      );
      expect(texto).not.toContain('apertura');
    });

    it('E12-H6 · CA1 apertura y clic: el recordatorio de carrito lleva la imagen y su botón al carrito pasa por el seguimiento', async () => {
      const { servicio, prisma } = conSeguimiento();
      prisma.itemCarrito.findMany.mockResolvedValue([
        formato('Shampoo Reparador', '300 ml', 2),
      ]);

      const { html, texto } = await servicio.construir(
        TRABAJOS_CORREO.RECORDATORIO_CARRITO,
        {
          notificacionId: 12,
          destinatario: 'camila@correo.cl',
          nombre: 'Camila',
        },
        { asunto: 'Tus productos te esperan', pedidoId: null, usuarioId: 20 },
      );

      expect(html).toContain('<img src="https://api.tienda.cl/apertura/9"');
      expect(html).toContain(
        'https://api.tienda.cl/clic/12?destino=https://tienda.cl/carrito',
      );
      expect(texto).toContain(
        'Ver mi carrito: https://api.tienda.cl/clic/12?destino=https://tienda.cl/carrito',
      );
    });

    it('E12-H6 · CA1 apertura y clic: el saludo de cumpleaños lleva la imagen y su botón a la tienda pasa por el seguimiento', async () => {
      const { servicio } = conSeguimiento();

      const { html } = await servicio.construir(
        TRABAJOS_CORREO.CUMPLEANOS,
        {
          notificacionId: 30,
          destinatario: 'camila@correo.cl',
          nombre: 'Camila',
        },
        { asunto: '¡Feliz cumpleaños!', pedidoId: null, usuarioId: 20 },
      );

      expect(html).toContain('<img src="https://api.tienda.cl/apertura/9"');
      expect(html).toContain(
        'https://api.tienda.cl/clic/30?destino=https://tienda.cl/catalogo',
      );
      expect(html).toContain(
        'href="https://tienda.cl/suscripcion/baja?token=firma-camila@correo.cl"',
      );
    });

    it('E12-H6 · un correo que no es publicidad no lleva seguimiento', async () => {
      const { servicio, seguimiento } = conSeguimiento();

      const { html } = await servicio.construir(
        TRABAJOS_CORREO.VERIFICACION_APROBADA,
        {
          notificacionId: 15,
          destinatario: 'andrea@correo.cl',
          nombre: 'Andrea',
        },
        { asunto: 'Ya eres profesional', pedidoId: null },
      );

      expect(seguimiento.enlaceApertura).not.toHaveBeenCalled();
      expect(seguimiento.enlaceClic).not.toHaveBeenCalled();
      expect(html).not.toContain('api.tienda.cl');
    });
  });
});
