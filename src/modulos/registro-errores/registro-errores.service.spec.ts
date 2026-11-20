import type { PrismaService } from '../../prisma/prisma.service.js';
import { RegistroErroresService } from './registro-errores.service.js';

const preparar = () => {
  const prisma = {
    usuario: { findUnique: vi.fn().mockResolvedValue({ id: 7 }) },
    registroError: { create: vi.fn().mockResolvedValue({}) },
  };
  const servicio = new RegistroErroresService(
    prisma as unknown as PrismaService,
  );
  return { prisma, servicio };
};

const ERROR = {
  codigoSeguimiento: 'abcd1234',
  origen: 'api' as const,
  componente: 'PedidosService.crear',
  tipoError: 'Error',
  mensaje: 'falló',
};

describe('RegistroErroresService', () => {
  it('SCRUM-168 · criterio 1: guarda el error con la cuenta que tenía sesión', async () => {
    const { prisma, servicio } = preparar();

    await servicio.guardar({ ...ERROR, usuario: 'cuenta-1', ruta: '/x?y=1' });

    expect(prisma.registroError.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        codigoSeguimiento: 'abcd1234',
        componente: 'PedidosService.crear',
        ruta: '/x',
        usuarioId: 7,
      }) as unknown,
    });
  });

  it('SCRUM-168 · criterio 5: si la base falla, no lanza', async () => {
    const { prisma, servicio } = preparar();
    prisma.registroError.create.mockRejectedValue(new Error('sin conexión'));

    await expect(servicio.guardar(ERROR)).resolves.toBeUndefined();
  });

  it('SCRUM-168 · criterio 3: un error del navegador conserva el código que traía de la API', async () => {
    const { prisma, servicio } = preparar();

    const respuesta = await servicio.registrarDelCliente(
      {
        origen: 'navegador',
        componente: 'app/(tienda)/carrito',
        mensaje: 'falló',
        codigoSeguimiento: 'codigo-api-1',
      },
      'codigo-reporte',
      undefined,
    );

    expect(respuesta).toEqual({ codigoSeguimiento: 'codigo-api-1' });
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
    expect(prisma.registroError.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        origen: 'navegador',
        tipoError: 'Error',
        usuarioId: null,
      }) as unknown,
    });
  });

  it('SCRUM-168 · sin código previo usa el de la petición del reporte', async () => {
    const { servicio } = preparar();

    const respuesta = await servicio.registrarDelCliente(
      { origen: 'servidor_web', componente: 'proxy', mensaje: 'x' },
      'codigo-reporte',
      undefined,
    );

    expect(respuesta.codigoSeguimiento).toBe('codigo-reporte');
  });
});
