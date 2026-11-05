import { TRABAJOS_CORREO } from '../../colas/colas.js';
import { ESTADOS_NOTIFICACION } from '../../common/dominio/valores.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { type ClienteCorreo, ErrorEnvioCorreo } from './cliente-correo.js';
import type { ContenidoCorreosService } from './contenido-correos.service.js';
import { EnvioCorreosService } from './envio-correos.service.js';

interface CuentaDestino {
  activo: boolean;
  rol: string;
  aceptaMarketingEmail: boolean;
  fechaVerificacionCorreo: Date | null;
}

const DATOS = {
  notificacionId: 7,
  destinatario: 'camila@correo.cl',
  nombre: 'Camila',
  enlace: 'https://tienda.cl/confirmar-correo?token=secreto',
};

describe('EnvioCorreosService', () => {
  let prisma: {
    notificacion: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };
  let cliente: { enviar: ReturnType<typeof vi.fn> };
  let servicio: EnvioCorreosService;

  beforeEach(() => {
    prisma = {
      notificacion: {
        findUnique: vi.fn().mockResolvedValue({
          estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
          asunto: 'Confirma tu correo',
          pedidoId: null,
        }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    cliente = { enviar: vi.fn().mockResolvedValue(undefined) };
    servicio = new EnvioCorreosService(
      prisma as unknown as PrismaService,
      {
        construir: vi.fn().mockReturnValue({ html: '<p>h</p>', texto: 't' }),
      } as unknown as ContenidoCorreosService,
      cliente as unknown as ClienteCorreo,
    );
  });

  it('E1-H6 · correo enviado: lo envía al destinatario con su plantilla y marca la NOTIFICACION como enviada', async () => {
    await servicio.enviar(TRABAJOS_CORREO.CONFIRMACION_CORREO, DATOS);

    expect(cliente.enviar).toHaveBeenCalledWith(
      expect.objectContaining({
        para: 'camila@correo.cl',
        asunto: 'Confirma tu correo',
        html: '<p>h</p>',
        texto: 't',
      }),
    );
    expect(prisma.notificacion.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { intentos: { increment: 1 } },
    });
    expect(prisma.notificacion.updateMany).toHaveBeenCalledWith({
      where: { id: 7, estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE },
      data: {
        estadoEnvio: ESTADOS_NOTIFICACION.ENVIADA,
        fechaEnvio: expect.any(Date) as Date,
      },
    });
  });

  it.each([ESTADOS_NOTIFICACION.ENVIADA, ESTADOS_NOTIFICACION.FALLIDA])(
    'E1-H6 · correo enviado: una notificación ya %s no se vuelve a enviar',
    async (estadoEnvio) => {
      prisma.notificacion.findUnique.mockResolvedValue({ estadoEnvio });

      await servicio.enviar(TRABAJOS_CORREO.CONFIRMACION_CORREO, DATOS);

      expect(cliente.enviar).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['desactivada', { activo: false, rol: 'bodeguero' }],
    ['sin ese rol', { activo: true, rol: 'vendedor' }],
  ])(
    'E11-H6 · RNF-28: el stock bajo no llega a una cuenta %s: queda fallida',
    async (_caso, usuario) => {
      prisma.notificacion.findUnique.mockResolvedValue({
        estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
        asunto: 'Stock bajo',
        pedidoId: null,
        usuario,
      });

      await servicio.enviar(TRABAJOS_CORREO.STOCK_BAJO, {
        notificacionId: 7,
        destinatario: 'b@correo.cl',
        nombre: 'B',
      });

      expect(cliente.enviar).not.toHaveBeenCalled();
      expect(prisma.notificacion.updateMany).toHaveBeenCalledWith({
        where: { id: 7, estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE },
        data: { estadoEnvio: ESTADOS_NOTIFICACION.FALLIDA },
      });
    },
  );

  it('E8-H2 · un cambio de estado usa el asunto del estado que avisa, aunque el guardado sea anterior', async () => {
    prisma.notificacion.findUnique.mockResolvedValue({
      estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
      asunto: 'Tu pedido ABC va en camino',
      pedidoId: 1,
    });

    await servicio.enviar(TRABAJOS_CORREO.CAMBIO_ESTADO_PEDIDO, {
      notificacionId: 7,
      destinatario: 'c@correo.cl',
      nombre: 'C',
      codigoPedido: 'ABC',
      estado: 'entregado',
      tipoEntrega: 'despacho',
    });

    expect(cliente.enviar.mock.calls[0][0].asunto).toBe(
      'Tu pedido ABC fue entregado',
    );
  });

  it('E1-H6 · una notificación borrada no se envía ni falla', async () => {
    prisma.notificacion.findUnique.mockResolvedValue(null);

    await servicio.enviar(TRABAJOS_CORREO.CONFIRMACION_CORREO, DATOS);

    expect(cliente.enviar).not.toHaveBeenCalled();
  });

  it('E1-H6 · envío fallido: el error llega a la cola para reintentar y sigue pendiente', async () => {
    cliente.enviar.mockRejectedValue(new ErrorEnvioCorreo('rechazado'));

    await expect(
      servicio.enviar(TRABAJOS_CORREO.CONFIRMACION_CORREO, DATOS),
    ).rejects.toThrow('rechazado');

    expect(prisma.notificacion.updateMany).not.toHaveBeenCalled();
  });

  it('E1-H6 · envío fallido: marcarla fallida solo toca una notificación pendiente', async () => {
    await servicio.marcarFallida(7);

    expect(prisma.notificacion.updateMany).toHaveBeenCalledWith({
      where: { id: 7, estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE },
      data: { estadoEnvio: ESTADOS_NOTIFICACION.FALLIDA },
    });
  });

  it('E1-H6 · enlace protegido: la clave de idempotencia no lleva el token y cambia con el enlace', async () => {
    await servicio.enviar(TRABAJOS_CORREO.CONFIRMACION_CORREO, DATOS);
    await servicio.enviar(TRABAJOS_CORREO.CONFIRMACION_CORREO, {
      ...DATOS,
      enlace: 'https://tienda.cl/confirmar-correo?token=otro',
    });

    const [primera, segunda] = (
      cliente.enviar.mock.calls as [{ claveIdempotencia: string }][]
    ).map(([mensaje]) => mensaje.claveIdempotencia);
    expect(primera).toMatch(/^notificacion-7-[0-9a-f]{16}$/);
    expect(primera).not.toContain('secreto');
    expect(segunda).not.toBe(primera);
  });

  it('E1-H6 · un aviso sin enlace repite siempre la misma clave de idempotencia', async () => {
    await servicio.enviar(TRABAJOS_CORREO.PAGO_CONFIRMADO, {
      notificacionId: 8,
      destinatario: 'camila@correo.cl',
      nombre: 'Camila',
      codigoPedido: 'ABC',
      montoTotal: 100,
    });

    expect(cliente.enviar.mock.calls[0][0].claveIdempotencia).toBe(
      'notificacion-8',
    );
  });

  describe('E10-H4 · correo de aprobación', () => {
    const AVISO = {
      notificacionId: 9,
      destinatario: 'andrea@correo.cl',
      nombre: 'Andrea',
    };
    const conCuenta = (usuario: { activo: boolean; rol: string }) =>
      prisma.notificacion.findUnique.mockResolvedValue({
        estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
        asunto: 'Tu cuenta profesional está activa',
        pedidoId: null,
        usuario,
      });

    it('E10-H4 · correo de aprobación: se envía a quien sigue activo y profesional', async () => {
      conCuenta({ activo: true, rol: 'profesional' });

      await servicio.enviar(TRABAJOS_CORREO.VERIFICACION_APROBADA, AVISO);

      expect(cliente.enviar).toHaveBeenCalledWith(
        expect.objectContaining({
          para: 'andrea@correo.cl',
          asunto: 'Tu cuenta profesional está activa',
        }),
      );
    });

    it('E10-H4 · correo de aprobación: si la desactivaron o ya no es profesional, queda fallida sin enviarse', async () => {
      for (const usuario of [
        { activo: false, rol: 'profesional' },
        { activo: true, rol: 'cliente' },
      ]) {
        conCuenta(usuario);

        await servicio.enviar(TRABAJOS_CORREO.VERIFICACION_APROBADA, AVISO);
      }

      expect(cliente.enviar).not.toHaveBeenCalled();
      expect(prisma.notificacion.updateMany).toHaveBeenCalledWith({
        where: { id: 9, estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE },
        data: { estadoEnvio: ESTADOS_NOTIFICACION.FALLIDA },
      });
    });
  });

  describe('E12-H2 · publicidad en cola', () => {
    const PUBLICIDAD = {
      notificacionId: 11,
      destinatario: 'camila@correo.cl',
      nombre: 'Camila',
    };
    const CUENTA_QUE_ACEPTA: CuentaDestino = {
      activo: true,
      rol: 'cliente',
      aceptaMarketingEmail: true,
      fechaVerificacionCorreo: new Date('2026-10-01T00:00:00Z'),
    };
    const deCampana = (destino: {
      usuario?: CuentaDestino | null;
      lead?: { activo: boolean } | null;
    }) =>
      prisma.notificacion.findUnique.mockResolvedValue({
        estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
        asunto: 'Ofertas de noviembre',
        tipo: 'campana',
        pedidoId: null,
        campanaId: 3,
        usuario: destino.usuario ?? null,
        lead: destino.lead ?? null,
      });
    const expectCancelada = () => {
      expect(cliente.enviar).not.toHaveBeenCalled();
      expect(prisma.notificacion.update).not.toHaveBeenCalled();
      expect(prisma.notificacion.updateMany).toHaveBeenCalledWith({
        where: { id: 11, estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE },
        data: { estadoEnvio: ESTADOS_NOTIFICACION.CANCELADA },
      });
    };

    it('E12-H2 · baja con correos pendientes: un suscriptor dado de baja no recibe la publicidad en cola y queda cancelada', async () => {
      deCampana({ lead: { activo: false } });

      await servicio.enviar('campana', PUBLICIDAD);

      expectCancelada();
    });

    it.each([
      ['que se dio de baja', { aceptaMarketingEmail: false }],
      ['desactivada', { activo: false }],
      ['sin el correo verificado', { fechaVerificacionCorreo: null }],
    ])(
      'E12-H2 · baja con correos pendientes: una cuenta %s no recibe la publicidad en cola y queda cancelada',
      async (_caso, cambio) => {
        deCampana({ usuario: { ...CUENTA_QUE_ACEPTA, ...cambio } });

        await servicio.enviar('campana', PUBLICIDAD);

        expectCancelada();
      },
    );

    it('E12-H2 · baja con correos pendientes: publicidad sin cuenta ni suscriptor queda cancelada', async () => {
      deCampana({});

      await servicio.enviar('campana', PUBLICIDAD);

      expectCancelada();
    });

    it.each([
      ['una cuenta que acepta ofertas', { usuario: CUENTA_QUE_ACEPTA }],
      ['un suscriptor confirmado', { lead: { activo: true } }],
    ])(
      'E12-H2 · consentimiento vigente: la publicidad para %s se envía',
      async (_caso, destino) => {
        deCampana(destino);

        await servicio.enviar('campana', PUBLICIDAD);

        expect(cliente.enviar).toHaveBeenCalledTimes(1);
        expect(prisma.notificacion.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              estadoEnvio: ESTADOS_NOTIFICACION.ENVIADA,
            }) as unknown,
          }),
        );
      },
    );

    it('E12-H2 · un correo que no es publicidad no revisa el consentimiento', async () => {
      prisma.notificacion.findUnique.mockResolvedValue({
        estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
        asunto: 'Confirma tu correo',
        tipo: 'confirmacion_correo',
        pedidoId: null,
        campanaId: null,
        usuario: { ...CUENTA_QUE_ACEPTA, aceptaMarketingEmail: false },
        lead: null,
      });

      await servicio.enviar(TRABAJOS_CORREO.CONFIRMACION_CORREO, DATOS);

      expect(cliente.enviar).toHaveBeenCalledTimes(1);
    });

    it('E12-H2 · la consulta de la notificación trae, en una sola selección de la cuenta, lo que revisan el consentimiento y los avisos por rol', async () => {
      deCampana({ usuario: CUENTA_QUE_ACEPTA });

      await servicio.enviar(TRABAJOS_CORREO.CONFIRMACION_CORREO, PUBLICIDAD);

      const { select } = prisma.notificacion.findUnique.mock.calls[0][0];
      expect(select.usuarioId).toBe(true);
      expect(select.usuario.select).toEqual({
        activo: true,
        rol: true,
        aceptaMarketingEmail: true,
        fechaVerificacionCorreo: true,
      });
    });
  });
});
