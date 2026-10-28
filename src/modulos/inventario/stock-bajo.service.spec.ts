import type { Queue } from 'bullmq';
import type { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { StockBajoService } from './stock-bajo.service.js';

const crearTx = () => ({
  $queryRaw: vi.fn().mockResolvedValue([{ id_formato: 11 }]),
  existencia: {
    aggregate: vi.fn().mockResolvedValue({ _sum: { cantidad: 4 } }),
  },
  formatoProducto: {
    findUnique: vi.fn().mockResolvedValue({
      stockMinimo: 5,
      nombreFormato: '300 ml',
      articulo: { sku: 'SH-300' },
      producto: { nombre: 'Shampoo Reparador' },
    }),
  },
  usuario: {
    findMany: vi.fn().mockResolvedValue([
      { id: 1, email: 'admin@cp.cl', nombre: 'Paula' },
      { id: 2, email: 'bodega@cp.cl', nombre: 'Diego' },
    ]),
  },
  notificacion: {
    createManyAndReturn: vi.fn().mockResolvedValue([
      { id: 70, usuarioId: 1 },
      { id: 71, usuarioId: 2 },
    ]),
  },
});

describe('StockBajoService', () => {
  let tx: ReturnType<typeof crearTx>;
  let prisma: { $queryRaw: ReturnType<typeof vi.fn> };
  let correos: {
    add: ReturnType<typeof vi.fn>;
    addBulk: ReturnType<typeof vi.fn>;
  };
  let servicio: StockBajoService;

  const comoTx = () => tx as unknown as Prisma.TransactionClient;

  beforeEach(() => {
    tx = crearTx();
    prisma = { $queryRaw: vi.fn().mockResolvedValue([]) };
    correos = {
      add: vi.fn().mockResolvedValue({ id: 'job-1' }),
      addBulk: vi.fn().mockResolvedValue([{ id: 'job-1' }]),
    };
    servicio = new StockBajoService(
      prisma as unknown as PrismaService,
      correos as unknown as Queue,
    );
  });

  it('E11-H6 · stock antes del movimiento: bloquea la fila del formato y suma todas sus ubicaciones', async () => {
    tx.existencia.aggregate.mockResolvedValue({ _sum: { cantidad: 9 } });

    await expect(servicio.stockAntes(comoTx(), 11)).resolves.toBe(9);

    const [partes, id] = tx.$queryRaw.mock.calls[0] as [string[], number];
    // NO KEY UPDATE: no choca con los INSERT con llave foránea al formato (sin deadlock)
    expect(partes.join('?')).toContain('FOR NO KEY UPDATE');
    expect(id).toBe(11);
    expect(tx.existencia.aggregate).toHaveBeenCalledWith({
      where: { formatoId: 11 },
      _sum: { cantidad: true },
    });
  });

  it('E11-H6 · stock antes del movimiento: sin existencias el total es 0', async () => {
    tx.existencia.aggregate.mockResolvedValue({ _sum: { cantidad: null } });

    await expect(servicio.stockAntes(comoTx(), 11)).resolves.toBe(0);
  });

  it('E11-H6 · stock bajo el mínimo: crea una notificación pendiente por cada bodeguero y administrador activo con el correo confirmado', async () => {
    const avisos = await servicio.avisarSiCruza(comoTx(), 11, 6);

    expect(tx.usuario.findMany).toHaveBeenCalledWith({
      where: {
        rol: { in: ['bodeguero', 'administrador'] },
        activo: true,
        fechaVerificacionCorreo: { not: null },
      },
      select: { id: true, email: true, nombre: true },
      orderBy: { id: 'asc' },
    });
    expect(tx.notificacion.createManyAndReturn).toHaveBeenCalledWith({
      data: [1, 2].map((usuarioId) => ({
        usuarioId,
        tipo: 'stock_bajo',
        asunto: 'Stock bajo el mínimo: Shampoo Reparador 300 ml',
        estadoEnvio: 'pendiente',
      })),
      select: { id: true, usuarioId: true },
    });
    const formato = {
      id: 11,
      sku: 'SH-300',
      producto: 'Shampoo Reparador',
      nombreFormato: '300 ml',
    };
    expect(avisos).toEqual([
      {
        notificacionId: 70,
        destinatario: 'admin@cp.cl',
        nombre: 'Paula',
        formato,
        stockTotal: 4,
        stockMinimo: 5,
      },
      {
        notificacionId: 71,
        destinatario: 'bodega@cp.cl',
        nombre: 'Diego',
        formato,
        stockTotal: 4,
        stockMinimo: 5,
      },
    ]);
  });

  it('E11-H6 · stock bajo el mínimo: avisa también si antes estaba justo en el mínimo', async () => {
    const avisos = await servicio.avisarSiCruza(comoTx(), 11, 5);

    expect(avisos).toHaveLength(2);
  });

  it('E11-H6 · stock sobre el mínimo: si queda igual al mínimo no avisa', async () => {
    tx.existencia.aggregate.mockResolvedValue({ _sum: { cantidad: 5 } });

    await expect(servicio.avisarSiCruza(comoTx(), 11, 8)).resolves.toEqual([]);
    expect(tx.notificacion.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('E11-H6 · stock sobre el mínimo: si queda sobre el mínimo no avisa', async () => {
    tx.existencia.aggregate.mockResolvedValue({ _sum: { cantidad: 7 } });

    await expect(servicio.avisarSiCruza(comoTx(), 11, 8)).resolves.toEqual([]);
    expect(tx.notificacion.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('E11-H6 · stock ya bajo el mínimo: un movimiento más no repite el correo', async () => {
    tx.existencia.aggregate.mockResolvedValue({ _sum: { cantidad: 2 } });

    await expect(servicio.avisarSiCruza(comoTx(), 11, 4)).resolves.toEqual([]);
    expect(tx.notificacion.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('E11-H6 · stock mínimo 0: el stock nunca queda bajo él y no avisa', async () => {
    tx.formatoProducto.findUnique.mockResolvedValue({
      stockMinimo: 0,
      nombreFormato: '300 ml',
      articulo: { sku: 'SH-300' },
      producto: { nombre: 'Shampoo Reparador' },
    });
    tx.existencia.aggregate.mockResolvedValue({ _sum: { cantidad: 0 } });

    await expect(servicio.avisarSiCruza(comoTx(), 11, 3)).resolves.toEqual([]);
  });

  it('E11-H6 · stock bajo el mínimo sin personal a quien avisar: no crea notificaciones', async () => {
    tx.usuario.findMany.mockResolvedValue([]);

    await expect(servicio.avisarSiCruza(comoTx(), 11, 6)).resolves.toEqual([]);
    expect(tx.notificacion.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('E11-H6 · stock bajo el mínimo: encola un correo stock-bajo por aviso, en una sola operación', async () => {
    const avisos = await servicio.avisarSiCruza(comoTx(), 11, 6);

    await servicio.encolar(avisos);

    expect(correos.addBulk).toHaveBeenCalledOnce();
    expect(correos.addBulk).toHaveBeenCalledWith(
      avisos.map((data) => ({
        name: 'stock-bajo',
        data,
        opts: expect.objectContaining({ priority: 1 }) as unknown,
      })),
    );
  });

  it('E11-H6 · stock sobre el mínimo: sin avisos no toca la cola', async () => {
    await servicio.encolar([]);

    expect(correos.add).not.toHaveBeenCalled();
    expect(correos.addBulk).not.toHaveBeenCalled();
  });

  it('RNF-32 · si Redis no responde, encolar no falla: la notificación queda pendiente', async () => {
    correos.addBulk.mockRejectedValue(new Error('Redis caído'));

    await expect(
      servicio.encolar(await servicio.avisarSiCruza(comoTx(), 11, 6)),
    ).resolves.toBeUndefined();
  });

  it('RNF-32 · si Redis no contesta, espera un solo plazo para todos los avisos', async () => {
    vi.useFakeTimers();
    try {
      correos.addBulk.mockReturnValue(new Promise(() => {}));
      const avisos = await servicio.avisarSiCruza(comoTx(), 11, 6);

      const encolado = servicio.encolar(avisos);
      await vi.advanceTimersByTimeAsync(2_000);

      await expect(encolado).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('E11-H6 · aviso del panel: devuelve los formatos bajo su mínimo con el faltante', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        formatoId: 11,
        sku: 'SH-300',
        producto: 'Shampoo Reparador',
        nombreFormato: '300 ml',
        activo: true,
        stockMinimo: 5,
        stockTotal: 2n,
      },
    ]);

    await expect(servicio.listarBajoMinimo()).resolves.toEqual([
      {
        formatoId: 11,
        sku: 'SH-300',
        producto: 'Shampoo Reparador',
        nombreFormato: '300 ml',
        activo: true,
        stockMinimo: 5,
        stockTotal: 2,
        faltante: 3,
      },
    ]);
  });

  it('E11-H6 · aviso del panel: sin formatos bajo el mínimo devuelve una lista vacía', async () => {
    await expect(servicio.listarBajoMinimo()).resolves.toEqual([]);
  });
});
