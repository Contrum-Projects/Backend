import { Logger } from '@nestjs/common';
import {
  ClienteCorreoSimulado,
  ClienteResend,
  ErrorEnvioCorreo,
  type MensajeCorreo,
} from './cliente-correo.js';

const { enviarResend } = vi.hoisted(() => ({ enviarResend: vi.fn() }));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: enviarResend };
  },
}));

const TOKEN = 'token-en-claro';
const MENSAJE: MensajeCorreo = {
  notificacionId: 7,
  para: 'camila@correo.cl',
  asunto: 'Confirma tu correo',
  html: `<a href="https://tienda.cl/?token=${TOKEN}">Confirmar</a>`,
  texto: `https://tienda.cl/?token=${TOKEN}`,
  claveIdempotencia: 'notificacion-7',
};

describe('Clientes de correo', () => {
  const cliente = new ClienteResend('re_clave', 'CP <no@cp.cl>');

  beforeEach(() => {
    enviarResend.mockReset();
  });

  it('E1-H6 · correo enviado: va por Resend con remitente, plantilla, logo y clave de idempotencia', async () => {
    enviarResend.mockResolvedValue({ data: { id: 'x' }, error: null });

    await cliente.enviar(MENSAJE);

    const [correo, opciones] = enviarResend.mock.calls[0];
    expect(correo).toMatchObject({
      from: 'CP <no@cp.cl>',
      to: 'camila@correo.cl',
      subject: 'Confirma tu correo',
      html: MENSAJE.html,
      text: MENSAJE.texto,
    });
    expect(correo.attachments[0].contentId).toBe('logo-cabello-perfecto');
    expect(opciones).toEqual({ idempotencyKey: 'notificacion-7' });
  });

  it('E1-H6 · envío fallido: un rechazo de Resend, que llega como dato, lanza un error', async () => {
    enviarResend.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', statusCode: 422, message: 'x' },
    });

    await expect(cliente.enviar(MENSAJE)).rejects.toThrow(ErrorEnvioCorreo);
    await expect(cliente.enviar(MENSAJE)).rejects.toThrow(
      'Resend rechazó el envío (validation_error, 422)',
    );
  });

  it('E1-H6 · envío fallido: si la API no responde, lanza un error sin el detalle original', async () => {
    enviarResend.mockRejectedValue(new Error(`fallo ${MENSAJE.para}`));

    const error = await cliente.enviar(MENSAJE).catch((e: Error) => e);

    expect(error).toBeInstanceOf(ErrorEnvioCorreo);
    expect((error as Error).message).toBe('No se pudo conectar con Resend');
  });

  it('E1-H6 · enlace protegido: el cliente simulado no registra el enlace ni el correo', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    await new ClienteCorreoSimulado().enviar(MENSAJE);

    const registrado = JSON.stringify(log.mock.calls);
    expect(registrado).toContain('notificación 7');
    expect(registrado).not.toContain(TOKEN);
    expect(registrado).not.toContain(MENSAJE.para);
    expect(enviarResend).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
