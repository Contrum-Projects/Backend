import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PRIORIDAD_CORREO, TRABAJOS_CORREO } from '../../colas/colas.js';
import { ROLES, type Rol } from '../../common/dominio/roles.js';
import {
  CANALES_VENTA,
  ESTADOS_NOTIFICACION,
  TIPOS_NOTIFICACION,
} from '../../common/dominio/valores.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  ASUNTO_ROL_PROFESIONAL_RETIRADO,
  CAMBIO_NO_PERMITIDO,
  CambioRolService,
  CUENTA_DESACTIVADA,
  NO_EXISTE_CUENTA,
  SIN_ACCESO,
  ULTIMO_ADMINISTRADOR,
} from './cambio-rol.service.js';

const ADMIN = {
  codigoPublico: 'a1a1a1a1-0000-4000-8000-000000000001',
  rol: ROLES.ADMINISTRADOR,
  sesion: 's1',
};
const OTRO_ADMIN = 'c3c3c3c3-0000-4000-8000-000000000003';
const CODIGO = 'b2b2b2b2-0000-4000-8000-000000000002';
const CUENTA_ID = 20;
const MOTIVO = 'Dejó de ejercer como peluquera según nos informó.';

const crearPrisma = ({
  administradores = [
    { id: 1, codigoPublico: ADMIN.codigoPublico },
    { id: CUENTA_ID, codigoPublico: CODIGO },
  ],
  rol = ROLES.ADMINISTRADOR as Rol,
  activo = true,
  existe = true,
} = {}) => {
  const tx = {
    // 1.º los administradores activos bloqueados; 2.º la fila de la cuenta (bloquearCuenta)
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce(administradores)
      .mockResolvedValueOnce(existe ? [{ id: CUENTA_ID }] : []),
    usuario: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        rol,
        activo,
        email: 'andrea@correo.cl',
        nombre: 'Andrea',
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    historialRol: { create: vi.fn().mockResolvedValue({ id: 5 }) },
    sesion: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    itemCarrito: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    notificacion: { create: vi.fn().mockResolvedValue({ id: 99 }) },
    pedido: { update: vi.fn(), updateMany: vi.fn() },
    detallePedido: { update: vi.fn(), updateMany: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { prisma, tx };
};

describe('CambioRolService', () => {
  let correos: { add: ReturnType<typeof vi.fn> };

  const preparar = (opciones?: Parameters<typeof crearPrisma>[0]) => {
    const { prisma, tx } = crearPrisma(opciones);
    correos = { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };
    const servicio = new CambioRolService(
      prisma as unknown as PrismaService,
      correos as unknown as Queue,
    );
    return { servicio, tx };
  };

  describe('rol del personal degradado (criterio 1)', () => {
    it('E13-H3 · rol del personal degradado: guarda el rol nuevo y registra quién lo cambió y cuándo', async () => {
      const { servicio, tx } = preparar();

      const cambio = await servicio.cambiar(
        CODIGO,
        { rol: ROLES.VENDEDOR },
        ADMIN,
      );

      expect(tx.usuario.update).toHaveBeenCalledWith({
        where: { id: CUENTA_ID },
        data: { rol: ROLES.VENDEDOR },
      });
      expect(tx.historialRol.create).toHaveBeenCalledWith({
        data: {
          usuarioId: CUENTA_ID,
          responsableId: 1,
          rolAnterior: ROLES.ADMINISTRADOR,
          rolNuevo: ROLES.VENDEDOR,
          motivo: null,
          fechaCambio: expect.any(Date),
        },
      });
      expect(cambio).toEqual({
        codigoPublico: CODIGO,
        rolAnterior: ROLES.ADMINISTRADOR,
        rol: ROLES.VENDEDOR,
        fechaCambio: expect.any(Date),
      });
    });

    it('E13-H3 · rol del personal degradado: también a bodeguero, con un motivo opcional que queda en el historial y sin correo', async () => {
      const { servicio, tx } = preparar();

      await servicio.cambiar(
        CODIGO,
        { rol: ROLES.BODEGUERO, motivo: 'Pasa a encargarse de la bodega.' },
        ADMIN,
      );

      expect(tx.historialRol.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          rolNuevo: ROLES.BODEGUERO,
          motivo: 'Pasa a encargarse de la bodega.',
        }),
      });
      expect(tx.notificacion.create).not.toHaveBeenCalled();
      expect(tx.itemCarrito.deleteMany).not.toHaveBeenCalled();
      expect(correos.add).not.toHaveBeenCalled();
    });

    it('E13-H3 · rol del personal degradado: bloquea a los administradores activos antes de leer la cuenta', async () => {
      const { servicio, tx } = preparar();

      await servicio.cambiar(CODIGO, { rol: ROLES.VENDEDOR }, ADMIN);

      const [consulta] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray];
      expect(consulta.join('?')).toContain('FOR UPDATE');
      expect(tx.$queryRaw.mock.calls[0]).toContain(ROLES.ADMINISTRADOR);
    });

    it('E13-H3 · el administrador puede bajarse a sí mismo si queda otro activo', async () => {
      const { servicio, tx } = preparar({
        administradores: [
          { id: 1, codigoPublico: ADMIN.codigoPublico },
          { id: 2, codigoPublico: OTRO_ADMIN },
        ],
      });
      tx.$queryRaw.mockReset();
      tx.$queryRaw
        .mockResolvedValueOnce([
          { id: 1, codigoPublico: ADMIN.codigoPublico },
          { id: 2, codigoPublico: OTRO_ADMIN },
        ])
        .mockResolvedValueOnce([{ id: 1 }]);

      await servicio.cambiar(
        ADMIN.codigoPublico,
        { rol: ROLES.VENDEDOR },
        ADMIN,
      );

      expect(tx.usuario.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { rol: ROLES.VENDEDOR },
      });
    });

    it('E13-H3 · quien cambia el rol ya no es administrador activo: 403 sin cambios', async () => {
      const { servicio, tx } = preparar({
        administradores: [{ id: 2, codigoPublico: OTRO_ADMIN }],
      });

      await expect(
        servicio.cambiar(CODIGO, { rol: ROLES.VENDEDOR }, ADMIN),
      ).rejects.toThrow(new ForbiddenException(SIN_ACCESO));
      expect(tx.usuario.update).not.toHaveBeenCalled();
    });
  });

  describe('sesiones abiertas (criterio 2)', () => {
    it('E13-H3 · sesiones abiertas: revoca todas las sesiones vigentes de la cuenta en la misma transacción', async () => {
      const { servicio, tx } = preparar();

      await servicio.cambiar(CODIGO, { rol: ROLES.VENDEDOR }, ADMIN);

      expect(tx.sesion.updateMany).toHaveBeenCalledWith({
        where: { usuarioId: CUENTA_ID, fechaRevocacion: null },
        data: { fechaRevocacion: expect.any(Date) },
      });
    });

    it('E13-H3 · sesiones abiertas: al profesional que vuelve a cliente también se le cierran', async () => {
      const { servicio, tx } = preparar({ rol: ROLES.PROFESIONAL });

      await servicio.cambiar(
        CODIGO,
        { rol: ROLES.CLIENTE, motivo: MOTIVO },
        ADMIN,
      );

      expect(tx.sesion.updateMany).toHaveBeenCalledWith({
        where: { usuarioId: CUENTA_ID, fechaRevocacion: null },
        data: { fechaRevocacion: expect.any(Date) },
      });
    });
  });

  describe('último administrador (criterio 3)', () => {
    it('E13-H3 · último administrador: rechaza con 409 y no cambia nada', async () => {
      const { servicio, tx } = preparar({
        administradores: [{ id: 1, codigoPublico: ADMIN.codigoPublico }],
      });
      tx.$queryRaw.mockReset();
      tx.$queryRaw
        .mockResolvedValueOnce([{ id: 1, codigoPublico: ADMIN.codigoPublico }])
        .mockResolvedValueOnce([{ id: 1 }]);

      await expect(
        servicio.cambiar(ADMIN.codigoPublico, { rol: ROLES.BODEGUERO }, ADMIN),
      ).rejects.toThrow(new ConflictException(ULTIMO_ADMINISTRADOR));
      expect(tx.usuario.update).not.toHaveBeenCalled();
      expect(tx.historialRol.create).not.toHaveBeenCalled();
      expect(tx.sesion.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('profesional que vuelve a cliente (criterio 4)', () => {
    it('E13-H3 · profesional que vuelve a cliente: guarda el rol cliente y el motivo en el historial', async () => {
      const { servicio, tx } = preparar({ rol: ROLES.PROFESIONAL });

      await servicio.cambiar(
        CODIGO,
        { rol: ROLES.CLIENTE, motivo: MOTIVO },
        ADMIN,
      );

      expect(tx.usuario.update).toHaveBeenCalledWith({
        where: { id: CUENTA_ID },
        data: { rol: ROLES.CLIENTE },
      });
      expect(tx.historialRol.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          rolAnterior: ROLES.PROFESIONAL,
          rolNuevo: ROLES.CLIENTE,
          motivo: MOTIVO,
        }),
      });
    });

    it('E13-H3 · profesional que vuelve a cliente: quita del carrito los productos y packs exclusivos', async () => {
      const { servicio, tx } = preparar({ rol: ROLES.PROFESIONAL });

      await servicio.cambiar(
        CODIGO,
        { rol: ROLES.CLIENTE, motivo: MOTIVO },
        ADMIN,
      );

      expect(tx.itemCarrito.deleteMany).toHaveBeenCalledWith({
        where: {
          carrito: { usuarioId: CUENTA_ID },
          articulo: {
            OR: [
              {
                formato: {
                  producto: { canalVenta: CANALES_VENTA.PROFESIONAL },
                },
              },
              { pack: { canalVenta: CANALES_VENTA.PROFESIONAL } },
            ],
          },
        },
      });
    });

    it('E13-H3 · profesional que vuelve a cliente: registra el correo en la transacción y lo encola después del commit', async () => {
      const { servicio, tx } = preparar({ rol: ROLES.PROFESIONAL });
      tx.notificacion.create.mockImplementation(() => {
        expect(correos.add).not.toHaveBeenCalled();
        return Promise.resolve({ id: 99 });
      });

      await servicio.cambiar(
        CODIGO,
        { rol: ROLES.CLIENTE, motivo: MOTIVO },
        ADMIN,
      );

      expect(tx.notificacion.create).toHaveBeenCalledWith({
        data: {
          usuarioId: CUENTA_ID,
          tipo: TIPOS_NOTIFICACION.ROL_PROFESIONAL_RETIRADO,
          asunto: ASUNTO_ROL_PROFESIONAL_RETIRADO,
          estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
        },
        select: { id: true },
      });
      // El motivo no viaja en Redis: se lee del historial al enviar
      expect(correos.add).toHaveBeenCalledWith(
        TRABAJOS_CORREO.ROL_PROFESIONAL_RETIRADO,
        {
          notificacionId: 99,
          destinatario: 'andrea@correo.cl',
          nombre: 'Andrea',
        },
        expect.objectContaining({
          priority: PRIORIDAD_CORREO.PEDIDO_Y_CUENTA,
          jobId: 'correo-99',
        }),
      );
    });

    it('E13-H3 · profesional que vuelve a cliente: si Redis no responde, el cambio no falla', async () => {
      const { servicio } = preparar({ rol: ROLES.PROFESIONAL });
      correos.add.mockRejectedValue(new Error('Redis caído'));

      await expect(
        servicio.cambiar(CODIGO, { rol: ROLES.CLIENTE, motivo: MOTIVO }, ADMIN),
      ).resolves.toMatchObject({ rol: ROLES.CLIENTE });
    });
  });

  describe('pedidos ya creados (criterio 5)', () => {
    it('E13-H3 · pedidos ya creados: no toca ningún pedido ni sus líneas, así conservan sus montos', async () => {
      const { servicio, tx } = preparar({ rol: ROLES.PROFESIONAL });

      await servicio.cambiar(
        CODIGO,
        { rol: ROLES.CLIENTE, motivo: MOTIVO },
        ADMIN,
      );

      expect(tx.pedido.update).not.toHaveBeenCalled();
      expect(tx.pedido.updateMany).not.toHaveBeenCalled();
      expect(tx.detallePedido.update).not.toHaveBeenCalled();
      expect(tx.detallePedido.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('cambios que no corresponden', () => {
    it.each([
      [ROLES.ADMINISTRADOR, ROLES.CLIENTE],
      [ROLES.PROFESIONAL, ROLES.VENDEDOR],
      [ROLES.PROFESIONAL, ROLES.BODEGUERO],
      [ROLES.VENDEDOR, ROLES.BODEGUERO],
      [ROLES.BODEGUERO, ROLES.VENDEDOR],
      [ROLES.VENDEDOR, ROLES.CLIENTE],
      [ROLES.CLIENTE, ROLES.CLIENTE],
      [ROLES.CLIENTE, ROLES.VENDEDOR],
    ] as [Rol, Rol][])(
      'E13-H3 · de %s a %s no baja el rol: 409 sin cambios',
      async (rol, destino) => {
        const { servicio, tx } = preparar({ rol });

        await expect(
          servicio.cambiar(CODIGO, { rol: destino, motivo: MOTIVO }, ADMIN),
        ).rejects.toThrow(new ConflictException(CAMBIO_NO_PERMITIDO));
        expect(tx.usuario.update).not.toHaveBeenCalled();
        expect(tx.sesion.updateMany).not.toHaveBeenCalled();
      },
    );

    it('E13-H3 · cuenta desactivada: 409 sin cambios', async () => {
      const { servicio, tx } = preparar({ activo: false });

      await expect(
        servicio.cambiar(CODIGO, { rol: ROLES.VENDEDOR }, ADMIN),
      ).rejects.toThrow(new ConflictException(CUENTA_DESACTIVADA));
      expect(tx.usuario.update).not.toHaveBeenCalled();
    });

    it('E13-H3 · cuenta inexistente: 404', async () => {
      const { servicio } = preparar({ existe: false });

      await expect(
        servicio.cambiar(CODIGO, { rol: ROLES.VENDEDOR }, ADMIN),
      ).rejects.toThrow(new NotFoundException(NO_EXISTE_CUENTA));
    });
  });
});
