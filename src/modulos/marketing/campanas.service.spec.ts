import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { TRABAJOS_CORREO } from '../../colas/colas.js';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_CAMPANA,
  TIPOS_NOTIFICACION,
} from '../../common/dominio/valores.js';
import type { Entorno } from '../../config/entorno.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { CampanasService } from './campanas.service.js';
import { HuellaCampana } from './huella-campana.js';

const CONFIG: Record<string, unknown> = {
  JWT_ACCESS_SECRET: 's'.repeat(32),
  URL_TIENDA: 'https://tienda.cl/',
};
const config = {
  get: (clave: string) => CONFIG[clave],
} as unknown as ConfigService<Entorno, true>;
const huella = new HuellaCampana(config);

const SEGMENTO_CLIENTES = '{"tipos":["cliente"],"categorias":[],"marcas":[]}';
const SEGMENTO_TODOS =
  '{"tipos":["cliente","suscriptor"],"categorias":[],"marcas":[]}';

const BORRADOR = {
  asunto: 'Novedades',
  cuerpo: 'Llegó la línea reparadora.',
  segmento: SEGMENTO_TODOS,
  fechaEncolado: null as Date | null,
};

const FILA = {
  id: 4,
  ...BORRADOR,
  fechaCreacion: new Date('2026-11-05T12:00:00Z'),
  usuario: { nombre: 'Rosa', apellido: 'Pérez' },
};

const confirmacionDe = (campana = BORRADOR) =>
  huella.calcular({
    id: 4,
    asunto: campana.asunto,
    cuerpo: campana.cuerpo,
    segmento: campana.segmento,
  });

type Fila = Record<string, unknown>;

const crearPrisma = () => {
  /** Lo que devuelve cada consulta cruda: la campaña bloqueada, las cuentas y los suscriptores. */
  const bd = {
    campana: [] as Fila[],
    cuentas: [] as Fila[],
    suscriptores: [] as Fila[],
  };
  const tx = {
    $queryRaw: vi.fn((partes: TemplateStringsArray) => {
      const sql = partes.join('?');
      if (sql.includes('FROM campana')) return Promise.resolve(bd.campana);
      if (sql.includes('FROM lead')) return Promise.resolve(bd.suscriptores);
      return Promise.resolve(bd.cuentas);
    }),
    categoria: { findMany: vi.fn().mockResolvedValue([]) },
    campana: { update: vi.fn().mockResolvedValue({}) },
    notificacion: {
      createManyAndReturn: vi.fn(
        ({ data }: { data: { usuarioId?: number; leadId?: number }[] }) =>
          Promise.resolve(
            data.map((fila, i) => ({
              id: 100 + i,
              usuarioId: fila.usuarioId ?? null,
              leadId: fila.leadId ?? null,
            })),
          ),
      ),
    },
  };
  return {
    bd,
    tx,
    ...tx,
    usuario: { findUnique: vi.fn().mockResolvedValue({ id: 1 }) },
    categoria: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    marca: { count: vi.fn().mockResolvedValue(0) },
    campana: {
      create: vi.fn().mockResolvedValue(FILA),
      findFirst: vi.fn().mockResolvedValue(FILA),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    notificacion: { groupBy: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
};

describe('CampanasService', () => {
  let prisma: ReturnType<typeof crearPrisma>;
  let cola: {
    add: ReturnType<typeof vi.fn>;
    addBulk: ReturnType<typeof vi.fn>;
  };
  let servicio: CampanasService;

  /** La campaña bloqueada y las cuentas del segmento que aceptan publicidad. */
  const alEnviar = (
    campana: typeof BORRADOR | undefined,
    cuentas: { id: number; email: string }[] = [],
  ) => {
    prisma.bd.campana = campana ? [campana] : [];
    prisma.bd.cuentas = cuentas;
  };

  beforeEach(() => {
    prisma = crearPrisma();
    cola = {
      add: vi.fn().mockResolvedValue({}),
      addBulk: vi.fn().mockResolvedValue([]),
    };
    servicio = new CampanasService(
      prisma as unknown as PrismaService,
      config,
      huella,
      cola as unknown as Queue,
    );
  });

  describe('enviar', () => {
    it('E12-H3 · CA1 campaña enviada: crea un correo por dirección del segmento, guarda el segmento usado y encola después del commit con prioridad de publicidad', async () => {
      alEnviar(BORRADOR, [{ id: 1, email: 'camila@correo.cl' }]);
      prisma.bd.suscriptores = [{ id: 20, email: 'visita@correo.cl' }];
      let enTransaccion = false;
      prisma.$transaction.mockImplementation(
        async (fn: (t: typeof prisma.tx) => unknown) => {
          enTransaccion = true;
          const resultado = await fn(prisma.tx);
          enTransaccion = false;
          return resultado;
        },
      );
      cola.addBulk.mockImplementation(() => {
        expect(enTransaccion).toBe(false);
        return Promise.resolve([]);
      });

      const respuesta = await servicio.enviar(4, confirmacionDe());

      expect(respuesta).toMatchObject({ id: 4, destinatarios: 2 });
      expect(prisma.tx.campana.update).toHaveBeenCalledWith({
        where: { id: 4 },
        data: {
          fechaEncolado: expect.any(Date) as Date,
          segmento: SEGMENTO_TODOS,
        },
      });
      const base = {
        campanaId: 4,
        tipo: TIPOS_NOTIFICACION.CAMPANA,
        asunto: 'Novedades',
        estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
      };
      expect(prisma.tx.notificacion.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            { ...base, usuarioId: 1 },
            { ...base, leadId: 20 },
          ],
        }),
      );
      const [trabajos] = cola.addBulk.mock.calls[0] as [
        { name: string; data: unknown; opts: { priority: number } }[],
      ];
      expect(trabajos).toEqual([
        expect.objectContaining({
          name: TRABAJOS_CORREO.CAMPANA,
          data: { notificacionId: 100, destinatario: 'camila@correo.cl' },
          opts: expect.objectContaining({ priority: 10 }) as unknown,
        }),
        expect.objectContaining({
          data: { notificacionId: 101, destinatario: 'visita@correo.cl' },
        }),
      ]);
    });

    it('E12-H3 · CA2 envío repetido: una campaña ya enviada responde 409 y no crea ni encola correos', async () => {
      alEnviar({ ...BORRADOR, fechaEncolado: new Date() });

      await expect(servicio.enviar(4, confirmacionDe())).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.tx.campana.update).not.toHaveBeenCalled();
      expect(prisma.tx.notificacion.createManyAndReturn).not.toHaveBeenCalled();
      expect(cola.add).not.toHaveBeenCalled();
      expect(cola.addBulk).not.toHaveBeenCalled();
    });

    it('E12-H3 · CA2 envío repetido: la campaña se lee bloqueada (FOR UPDATE), así dos confirmaciones simultáneas no la envían dos veces', async () => {
      alEnviar(BORRADOR, [{ id: 1, email: 'camila@correo.cl' }]);

      await servicio.enviar(4, confirmacionDe());

      const [consulta] = prisma.tx.$queryRaw.mock.calls[0] as [
        TemplateStringsArray,
      ];
      expect(consulta.join('?')).toContain('FOR UPDATE');
    });

    it('E12-H3 · CA2 llega una vez a cada dirección: una cuenta y una suscripción con el mismo correo reciben un solo correo', async () => {
      alEnviar(BORRADOR, [{ id: 1, email: 'camila@correo.cl' }]);
      prisma.bd.suscriptores = [{ id: 20, email: 'camila@correo.cl' }];

      const respuesta = await servicio.enviar(4, confirmacionDe());

      expect(respuesta.destinatarios).toBe(1);
      const [{ data }] = prisma.tx.notificacion.createManyAndReturn.mock
        .calls[0] as [{ data: unknown[] }];
      expect(data).toEqual([expect.objectContaining({ usuarioId: 1 })]);
    });

    it('E12-H3 · CA3 destinatarios sin consentimiento: solo se buscan cuentas activas, verificadas y que aceptan ofertas, y suscriptores confirmados', async () => {
      alEnviar(BORRADOR, [{ id: 1, email: 'camila@correo.cl' }]);

      await servicio.enviar(4, confirmacionDe());

      const [consulta] = prisma.tx.$queryRaw.mock.calls[1] as [
        TemplateStringsArray,
      ];
      const sql = consulta.join('?');
      expect(sql).toContain('u.activo');
      expect(sql).toContain('u.acepta_marketing_email');
      expect(sql).toContain('u.fecha_verificacion_correo IS NOT NULL');
      const [suscriptores] = prisma.tx.$queryRaw.mock.calls[2] as [
        TemplateStringsArray,
      ];
      const sqlSuscriptores = suscriptores.join('?');
      expect(sqlSuscriptores).toContain('l.activo');
      // Si el correo es de una cuenta, decide la cuenta (decisión del 5 nov)
      expect(sqlSuscriptores).toContain(
        'NOT EXISTS (SELECT 1 FROM usuario u WHERE u.email = l.email)',
      );
    });

    it('E12-H3 · una campaña que cambió después de la vista previa responde 409 y no se envía', async () => {
      const confirmacion = confirmacionDe();
      alEnviar({ ...BORRADOR, cuerpo: 'Texto editado después' });

      await expect(servicio.enviar(4, confirmacion)).rejects.toThrow(
        'Pide otra vista previa',
      );
      expect(prisma.tx.campana.update).not.toHaveBeenCalled();
    });

    it('E12-H3 · un segmento sin nadie que acepte publicidad responde 409 y la campaña sigue como borrador', async () => {
      alEnviar({ ...BORRADOR, segmento: SEGMENTO_CLIENTES }, []);

      await expect(
        servicio.enviar(
          4,
          confirmacionDe({ ...BORRADOR, segmento: SEGMENTO_CLIENTES }),
        ),
      ).rejects.toThrow('no tiene destinatarios');
      expect(prisma.tx.campana.update).not.toHaveBeenCalled();
    });

    it('E12-H3 · con una vista previa de hace más de una hora, el envío responde 409 y pide otra', async () => {
      alEnviar(BORRADOR, [{ id: 1, email: 'camila@correo.cl' }]);
      const vieja = huella.calcular(
        {
          id: 4,
          asunto: BORRADOR.asunto,
          cuerpo: BORRADOR.cuerpo,
          segmento: BORRADOR.segmento,
        },
        new Date(Date.now() - 61 * 60 * 1000),
      );

      await expect(servicio.enviar(4, vieja)).rejects.toThrow(
        'más de una hora',
      );
      expect(prisma.tx.campana.update).not.toHaveBeenCalled();
    });

    it('E12-H3 · una campaña que no existe responde 404', async () => {
      alEnviar(undefined);

      await expect(servicio.enviar(4, confirmacionDe())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('E12-H3 · RNF-32: si Redis no responde al encolar, la campaña queda enviada con sus correos pendientes', async () => {
      alEnviar(BORRADOR, [{ id: 1, email: 'camila@correo.cl' }]);
      cola.add.mockRejectedValue(new Error('Redis caído'));

      await expect(servicio.enviar(4, confirmacionDe())).resolves.toMatchObject(
        { destinatarios: 1 },
      );
      expect(prisma.tx.campana.update).toHaveBeenCalled();
    });
  });

  describe('vista previa', () => {
    it('E12-H3 · CA1 la vista previa muestra el correo, cuántos lo recibirían y la confirmación del envío', async () => {
      prisma.bd.cuentas = [{ id: 1, email: 'camila@correo.cl' }];
      prisma.bd.suscriptores = [{ id: 20, email: 'visita@correo.cl' }];

      const vista = await servicio.vistaPrevia(4);

      expect(vista.destinatarios).toBe(2);
      expect(vista.html).toContain('Llegó la línea reparadora.');
      expect(vista.html).toContain('https://tienda.cl/suscripcion/baja"');
      expect(
        huella.verificar(
          {
            id: 4,
            asunto: BORRADOR.asunto,
            cuerpo: BORRADOR.cuerpo,
            segmento: BORRADOR.segmento,
          },
          vista.confirmacion,
        ),
      ).toBe('valida');
    });

    it('E12-H3 · CA2 una campaña ya enviada no tiene vista previa para confirmar: 409', async () => {
      prisma.campana.findFirst.mockResolvedValue({
        ...FILA,
        fechaEncolado: new Date(),
      });

      await expect(servicio.vistaPrevia(4)).rejects.toThrow(ConflictException);
    });
  });

  describe('crear y editar', () => {
    it('E12-H3 · CA1 la campaña nace como borrador de envío único con su segmento ordenado', async () => {
      await servicio.crear(
        {
          asunto: 'Novedades',
          cuerpo: 'Texto',
          segmento: { tipos: ['profesional', 'cliente'] },
        },
        'uuid-admin',
      );

      expect(prisma.campana.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            usuarioId: 1,
            tipo: TIPOS_CAMPANA.ENVIO_UNICO,
            asunto: 'Novedades',
            cuerpo: 'Texto',
            segmento:
              '{"tipos":["cliente","profesional"],"categorias":[],"marcas":[]}',
          },
        }),
      );
    });

    it('E12-H3 · suscriptores con un filtro de compras: 400, porque no tienen compras', async () => {
      await expect(
        servicio.crear(
          {
            asunto: 'A',
            cuerpo: 'B',
            segmento: { tipos: ['suscriptor'], categorias: [3] },
          },
          'uuid-admin',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.campana.create).not.toHaveBeenCalled();
    });

    it.each([
      ['categoría', { categorias: [3] }, 'categoría'],
      ['marca', { marcas: [7] }, 'marca'],
    ])(
      'E12-H3 · una %s que no existe: 400',
      async (_caso, filtros, mensaje) => {
        await expect(
          servicio.crear(
            {
              asunto: 'A',
              cuerpo: 'B',
              segmento: { tipos: ['cliente'], ...filtros },
            },
            'uuid-admin',
          ),
        ).rejects.toThrow(mensaje);
      },
    );

    it('E12-H3 · CA2 una campaña ya enviada no se edita: 409', async () => {
      prisma.campana.updateMany.mockResolvedValue({ count: 0 });
      prisma.campana.findFirst.mockResolvedValue({
        ...FILA,
        fechaEncolado: new Date(),
      });

      await expect(servicio.actualizar(4, { asunto: 'Otro' })).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.campana.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 4,
            tipo: TIPOS_CAMPANA.ENVIO_UNICO,
            fechaEncolado: null,
          },
        }),
      );
    });

    it('E12-H3 · editar sin ningún campo: 400', async () => {
      await expect(servicio.actualizar(4, {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  it('E12-H3 · el detalle cuenta los correos de la campaña por estado, también los rebotados (E12-H6)', async () => {
    prisma.campana.findFirst.mockResolvedValue({
      ...FILA,
      fechaEncolado: new Date(),
    });
    prisma.notificacion.groupBy.mockResolvedValue([
      { estadoEnvio: ESTADOS_NOTIFICACION.ENVIADA, _count: { _all: 5 } },
      { estadoEnvio: ESTADOS_NOTIFICACION.CANCELADA, _count: { _all: 2 } },
      { estadoEnvio: ESTADOS_NOTIFICACION.REBOTADA, _count: { _all: 1 } },
    ]);

    const detalle = await servicio.obtener(4);

    expect(detalle.enviada).toBe(true);
    expect(detalle.envios).toEqual({
      total: 8,
      pendientes: 0,
      enviados: 5,
      fallidos: 0,
      cancelados: 2,
      rebotados: 1,
    });
  });
});
