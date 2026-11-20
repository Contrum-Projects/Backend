import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  ConsultaRegistroErroresService,
  DIAS_RETENCION_REGISTRO_ERRORES,
} from './consulta-registro-errores.service.js';

const preparar = () => {
  const prisma = {
    registroError: {
      findMany: vi.fn().mockReturnValue('filas'),
      count: vi.fn().mockReturnValue('conteo'),
      deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
    },
    $transaction: vi.fn().mockResolvedValue([
      [
        {
          codigoSeguimiento: 'abc12345',
          fechaHora: new Date('2026-11-20T15:00:00Z'),
          origen: 'api',
          componente: 'PedidosService.crear',
          metodo: 'POST',
          ruta: '/api/pedidos',
          estadoHttp: 500,
          tipoError: 'TypeError',
          mensaje: 'falló',
          traza: null,
          usuario: {
            codigoPublico: 'cuenta-1',
            nombre: 'Andrea',
            apellido: 'Soto',
            email: 'andrea@correo.cl',
          },
        },
      ],
      1,
      1,
      1,
      0,
      0,
    ]),
  };
  const servicio = new ConsultaRegistroErroresService(
    prisma as unknown as PrismaService,
  );
  return { prisma, servicio };
};

describe('ConsultaRegistroErroresService', () => {
  it('SCRUM-168 · lista los errores con la cuenta, los conteos y los días de retención', async () => {
    const { servicio } = preparar();

    const listado = await servicio.listar({});

    expect(listado).toMatchObject({
      total: 1,
      pagina: 1,
      limite: 20,
      conteos: { todos: 1, api: 1, navegador: 0, servidorWeb: 0 },
      diasRetencion: DIAS_RETENCION_REGISTRO_ERRORES,
    });
    expect(listado.items[0]).toMatchObject({
      codigoSeguimiento: 'abc12345',
      cuenta: {
        codigoPublico: 'cuenta-1',
        nombre: 'Andrea Soto',
        email: 'andrea@correo.cl',
      },
    });
  });

  it('SCRUM-168 · los días se cuentan en hora de Chile y hasta se incluye entero', async () => {
    const { prisma, servicio } = preparar();

    await servicio.listar({ desde: '2026-11-20', hasta: '2026-11-20' });

    const { where } = prisma.registroError.findMany.mock.calls[0]?.[0] as {
      where: { AND: [{ AND: unknown[] }] };
    };
    expect(where.AND[0].AND.slice(0, 2)).toEqual([
      { fechaHora: { gte: new Date('2026-11-20T03:00:00Z') } },
      { fechaHora: { lt: new Date('2026-11-21T03:00:00Z') } },
    ]);
  });

  it('SCRUM-168 · hasta antes que desde: 400 en el campo hasta', async () => {
    const { servicio } = preparar();

    await expect(
      servicio.listar({ desde: '2026-11-20', hasta: '2026-11-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('SCRUM-168 · la limpieza borra solo lo anterior a 90 días', async () => {
    const { prisma, servicio } = preparar();
    const ahora = new Date('2026-11-20T12:00:00Z');

    expect(await servicio.eliminarAntiguos(ahora)).toBe(3);
    expect(prisma.registroError.deleteMany).toHaveBeenCalledWith({
      where: { fechaHora: { lt: new Date('2026-08-22T12:00:00Z') } },
    });
  });
});
