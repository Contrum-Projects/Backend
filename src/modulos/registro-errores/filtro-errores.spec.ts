import type { ArgumentsHost } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { FiltroErrores } from './filtro-errores.js';
import type { RegistroErroresService } from './registro-errores.service.js';

const CODIGO = '3f1c2b9e-8a7d-4e0b-9a51-2c4d6e8f0a1b';

const preparar = (peticion: Record<string, unknown> = {}) => {
  const guardar = vi.fn().mockResolvedValue(undefined);
  const filtro = new FiltroErrores({
    guardar,
  } as unknown as RegistroErroresService);
  const respuesta = {
    headersSent: false,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn(),
  };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({
        id: CODIGO,
        method: 'POST',
        originalUrl: '/api/pedidos?token=secreto',
        ...peticion,
      }),
      getResponse: () => respuesta,
    }),
  } as unknown as ArgumentsHost;
  return { filtro, guardar, respuesta, host };
};

describe('FiltroErrores', () => {
  it('SCRUM-168 · criterio 1: un error no controlado responde 500 con el código y queda registrado', () => {
    const { filtro, guardar, respuesta, host } = preparar({
      usuario: { codigoPublico: 'cuenta-1', rol: 'cliente', sesion: 's' },
    });

    filtro.catch(new Error('se cayó'), host);

    expect(respuesta.status).toHaveBeenCalledWith(500);
    expect(respuesta.json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Internal server error',
      codigoSeguimiento: CODIGO,
    });
    expect(guardar).toHaveBeenCalledWith(
      expect.objectContaining({
        codigoSeguimiento: CODIGO,
        origen: 'api',
        metodo: 'POST',
        ruta: '/api/pedidos',
        estadoHttp: 500,
        tipoError: 'Error',
        mensaje: 'se cayó',
        usuario: 'cuenta-1',
      }),
    );
  });

  it('SCRUM-168 · criterio 2: un 4xx responde lo de siempre y no se registra', () => {
    const { filtro, guardar, respuesta, host } = preparar();

    filtro.catch(new ConflictException('Ya existe.'), host);

    expect(respuesta.status).toHaveBeenCalledWith(409);
    expect(respuesta.json).toHaveBeenCalledWith({
      statusCode: 409,
      message: 'Ya existe.',
      error: 'Conflict',
    });
    expect(guardar).not.toHaveBeenCalled();
  });

  it('SCRUM-168 · criterio 4: la ruta registrada no lleva la query', () => {
    const { filtro, guardar, host } = preparar();

    filtro.catch(new Error('x'), host);

    const datos = guardar.mock.calls[0]?.[0] as { ruta: string };
    expect(datos.ruta).not.toContain('token');
  });

  it('SCRUM-168 · si la respuesta ya empezó (descarga), solo la cierra', () => {
    const { filtro, respuesta, host } = preparar();
    respuesta.headersSent = true;

    filtro.catch(new Error('x'), host);

    expect(respuesta.end).toHaveBeenCalled();
    expect(respuesta.json).not.toHaveBeenCalled();
  });
});
