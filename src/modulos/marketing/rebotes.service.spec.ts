import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { ESTADOS_NOTIFICACION } from '../../common/dominio/valores.js';
import type { Entorno } from '../../config/entorno.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { type AvisoRecibido, RebotesService } from './rebotes.service.js';

const CLAVE = Buffer.from('clave-del-webhook-de-prueba-32by');
const SECRETO = `whsec_${CLAVE.toString('base64')}`;

/** Firma como Resend (Standard Webhooks): HMAC-SHA256 de `id.marca.cuerpo`. */
const firmar = (
  evento: unknown,
  { secreto = CLAVE, marca = Math.floor(Date.now() / 1000) } = {},
): AvisoRecibido => {
  const cuerpo = JSON.stringify(evento);
  const id = 'msg_prueba';
  const firma = createHmac('sha256', secreto)
    .update(`${id}.${marca}.${cuerpo}`)
    .digest('base64');
  return {
    cuerpo: Buffer.from(cuerpo),
    id,
    marcaTiempo: String(marca),
    firma: `v1,${firma}`,
  };
};

const rebote = (data: Record<string, unknown>) => ({
  type: 'email.bounced',
  created_at: '2026-11-05T12:00:00.000Z',
  data: {
    email_id: 're_123',
    to: ['Camila@Correo.cl'],
    subject: 'Novedades',
    tags: { notificacion: '9' },
    bounce: { type: 'Permanent', subType: 'General', message: 'No existe' },
    ...data,
  },
});

describe('RebotesService', () => {
  /** `null`: sin secreto configurado. */
  const crear = (secreto: string | null = SECRETO) => {
    const tx = {
      notificacion: {
        // Por defecto, la notificación 9 es de la cuenta del aviso
        findUnique: vi.fn().mockResolvedValue({
          usuario: { email: 'camila@correo.cl' },
          lead: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      lead: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      usuario: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      $transaction: vi.fn((trabajo: (cliente: typeof tx) => Promise<unknown>) =>
        trabajo(tx),
      ),
    };
    const config = {
      get: (clave: string) =>
        clave === 'RESEND_WEBHOOK_SECRET' ? (secreto ?? undefined) : undefined,
    } as unknown as ConfigService<Entorno, true>;
    return {
      tx,
      prisma,
      servicio: new RebotesService(prisma as unknown as PrismaService, config),
    };
  };

  it('E12-H6 · CA2 correo rebotado: marca la notificación como rebotada y deja la dirección sin publicidad, en una transacción', async () => {
    const { servicio, prisma, tx } = crear();

    await servicio.recibir(firmar(rebote({})));

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.notificacion.updateMany).toHaveBeenCalledWith({
      where: {
        id: 9,
        estadoEnvio: {
          in: [ESTADOS_NOTIFICACION.PENDIENTE, ESTADOS_NOTIFICACION.ENVIADA],
        },
      },
      data: { estadoEnvio: ESTADOS_NOTIFICACION.REBOTADA },
    });
    // En minúsculas, como se guardan cuentas y suscripciones
    expect(tx.lead.updateMany).toHaveBeenCalledWith({
      where: { email: 'camila@correo.cl' },
      data: { activo: false, fechaBaja: expect.any(Date) },
    });
    expect(tx.usuario.updateMany).toHaveBeenCalledWith({
      where: { email: 'camila@correo.cl', aceptaMarketingEmail: true },
      data: { aceptaMarketingEmail: false },
    });
  });

  it('E12-H6 · CA2 cualquier correo cuenta: sin etiqueta de notificación igual deja la dirección sin publicidad', async () => {
    const { servicio, tx } = crear();

    await servicio.recibir(firmar(rebote({ tags: undefined })));

    expect(tx.notificacion.updateMany).not.toHaveBeenCalled();
    expect(tx.usuario.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'camila@correo.cl', aceptaMarketingEmail: true },
      }),
    );
  });

  it('E12-H6 · CA2 la notificación de un suscriptor sin cuenta también queda rebotada', async () => {
    const { servicio, tx } = crear();
    tx.notificacion.findUnique.mockResolvedValue({
      usuario: null,
      lead: { email: 'camila@correo.cl' },
    });

    await servicio.recibir(firmar(rebote({})));

    expect(tx.notificacion.updateMany).toHaveBeenCalledTimes(1);
  });

  it('E12-H6 · CA2 una etiqueta de otra persona (otro ambiente en la misma cuenta de Resend) no toca esa notificación, pero la dirección que rebotó queda sin publicidad', async () => {
    const { servicio, tx } = crear();
    tx.notificacion.findUnique.mockResolvedValue({
      usuario: { email: 'otra@correo.cl' },
      lead: null,
    });

    await servicio.recibir(firmar(rebote({})));

    expect(tx.notificacion.updateMany).not.toHaveBeenCalled();
    expect(tx.usuario.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'camila@correo.cl', aceptaMarketingEmail: true },
      }),
    );
  });

  it('E12-H6 · CA2 un rechazo pasajero (Transient) no cuenta como rebote', async () => {
    const { servicio, prisma } = crear();

    await servicio.recibir(
      firmar(rebote({ bounce: { type: 'Transient', subType: 'MailboxFull' } })),
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('E12-H6 · CA2 una etiqueta que no es un id no toca ninguna notificación', async () => {
    const { servicio, tx } = crear();

    for (const notificacion of ['0', '-1', '9x', '12345678901']) {
      await servicio.recibir(firmar(rebote({ tags: { notificacion } })));
    }

    expect(tx.notificacion.updateMany).not.toHaveBeenCalled();
  });

  it('E12-H6 · CA2 el mismo aviso otra vez deja todo igual: solo cambian las que seguían pendientes o enviadas', async () => {
    const { servicio, tx } = crear();
    tx.notificacion.updateMany.mockResolvedValue({ count: 0 });
    const aviso = firmar(rebote({}));

    await servicio.recibir(aviso);
    await expect(servicio.recibir(aviso)).resolves.toBeUndefined();
  });

  it('E12-H6 · otros avisos de Resend se ignoran sin tocar nada', async () => {
    const { servicio, prisma } = crear();

    await servicio.recibir(firmar({ ...rebote({}), type: 'email.delivered' }));
    await servicio.recibir(firmar(rebote({ to: [], tags: {} })));

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('E12-H6 · firma inválida, de otro secreto, antigua o sin cabeceras: 401 sin tocar nada', async () => {
    const { servicio, prisma } = crear();
    const valido = firmar(rebote({}));
    const avisos: AvisoRecibido[] = [
      firmar(rebote({}), { secreto: Buffer.from('otra-clave') }),
      firmar(rebote({}), { marca: Math.floor(Date.now() / 1000) - 3600 }),
      { ...valido, cuerpo: Buffer.from('{"type":"email.bounced"}') },
      { ...valido, firma: undefined },
      { ...valido, cuerpo: undefined },
    ];

    for (const aviso of avisos) {
      await expect(servicio.recibir(aviso)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('E12-H6 · sin el secreto del webhook: 503 sin tocar nada', async () => {
    const { servicio, prisma } = crear(null);

    await expect(servicio.recibir(firmar(rebote({})))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
