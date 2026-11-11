import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ROLES } from '../../common/dominio/roles.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ClientesService, condicionBusqueda } from './clientes.service.js';

const ADMIN = {
  codigoPublico: 'a1a1a1a1-0000-4000-8000-000000000001',
  rol: ROLES.ADMINISTRADOR,
  sesion: 's1',
};
const CODIGO = 'b2b2b2b2-0000-4000-8000-000000000002';

const crearPrisma = (rol: string = ROLES.CLIENTE) => {
  const tx = {
    // 1.º el administrador activo (FOR SHARE), 2.º la cuenta bloqueada (FOR UPDATE)
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ id: 20 }]),
    usuario: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ rol }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    sesion: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
  };
  const prisma = {
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    usuario: { findFirst: vi.fn() },
  };
  return { prisma, tx };
};

const crearServicio = (rol?: string) => {
  const { prisma, tx } = crearPrisma(rol);
  return {
    servicio: new ClientesService(prisma as unknown as PrismaService),
    prisma,
    tx,
  };
};

describe('condicionBusqueda', () => {
  it('E13-H4 · sin búsqueda no filtra', () => {
    expect(condicionBusqueda(undefined)).toEqual({});
    expect(condicionBusqueda('   ')).toEqual({});
  });

  it('E13-H4 · listado: cada palabra debe estar en el nombre, el apellido, el correo o el RUT', () => {
    const condicion = condicionBusqueda('andrea soto');
    expect(condicion).toEqual({
      AND: [
        expect.objectContaining({
          OR: expect.arrayContaining([
            { nombre: { contains: 'andrea', mode: 'insensitive' } },
            { email: { contains: 'andrea', mode: 'insensitive' } },
          ]) as unknown,
        }),
        expect.objectContaining({
          OR: expect.arrayContaining([
            { apellido: { contains: 'soto', mode: 'insensitive' } },
          ]) as unknown,
        }),
      ],
    });
  });

  it('E13-H4 · listado: un RUT válido con puntos busca la cuenta por su RUT normalizado', () => {
    const condicion = condicionBusqueda('12.345.678-5');
    expect(condicion).toEqual({
      OR: [{ rut: '12345678-5' }, expect.any(Object)],
    });
  });

  it('E13-H4 · listado: escapa los comodines de ILIKE', () => {
    const condicion = condicionBusqueda('50%') as {
      AND: { OR: { nombre?: { contains: string } }[] }[];
    };
    expect(condicion.AND[0].OR[0].nombre?.contains).toBe('50\\%');
  });
});

describe('ClientesService', () => {
  it('E13-H4 · desactivar: pone activo en falso y cierra todas sus sesiones', async () => {
    const { servicio, tx } = crearServicio();
    await servicio.desactivar(CODIGO, ADMIN);
    expect(tx.usuario.updateMany).toHaveBeenCalledWith({
      where: { id: 20, activo: true },
      data: { activo: false },
    });
    expect(tx.sesion.updateMany).toHaveBeenCalledWith({
      where: { usuarioId: 20, fechaRevocacion: null },
      data: { fechaRevocacion: expect.any(Date) as unknown },
    });
  });

  it('E13-H4 · desactivar una cuenta ya desactivada no cambia nada', async () => {
    const { servicio, tx } = crearServicio();
    tx.usuario.updateMany.mockResolvedValue({ count: 0 });
    await servicio.desactivar(CODIGO, ADMIN);
    expect(tx.sesion.updateMany).not.toHaveBeenCalled();
  });

  it('E13-H4 · reactivar: pone activo en verdadero sin tocar las sesiones', async () => {
    const { servicio, tx } = crearServicio(ROLES.PROFESIONAL);
    await servicio.reactivar(CODIGO, ADMIN);
    expect(tx.usuario.updateMany).toHaveBeenCalledWith({
      where: { id: 20, activo: false },
      data: { activo: true },
    });
    expect(tx.sesion.updateMany).not.toHaveBeenCalled();
  });

  it('E13-H4 · alcance: una cuenta del personal responde 404 y no cambia', async () => {
    for (const rol of [ROLES.VENDEDOR, ROLES.ADMINISTRADOR]) {
      const { servicio, tx } = crearServicio(rol);
      await expect(servicio.desactivar(CODIGO, ADMIN)).rejects.toThrow(
        NotFoundException,
      );
      expect(tx.usuario.updateMany).not.toHaveBeenCalled();
    }
  });

  it('E13-H4 · quien pide ya no es administrador activo: 403 sin cambios', async () => {
    const { servicio, tx } = crearServicio();
    tx.$queryRaw.mockReset().mockResolvedValueOnce([]);
    await expect(servicio.reactivar(CODIGO, ADMIN)).rejects.toThrow(
      ForbiddenException,
    );
    expect(tx.usuario.updateMany).not.toHaveBeenCalled();
  });

  it('E13-H4 · detalle de una cuenta inexistente o del personal: 404', async () => {
    const { servicio, prisma } = crearServicio();
    prisma.usuario.findFirst.mockResolvedValue(null);
    await expect(servicio.detalle(CODIGO)).rejects.toThrow(NotFoundException);
    expect(prisma.usuario.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          codigoPublico: CODIGO,
          rol: { in: [ROLES.CLIENTE, ROLES.PROFESIONAL] },
        },
      }),
    );
  });
});
