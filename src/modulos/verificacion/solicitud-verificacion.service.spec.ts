import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  ASUNTO_VERIFICACION_APROBADA,
  CUENTA_NO_APROBABLE,
} from './aprobacion-verificacion.js';
import {
  ConsultaSiiNoDisponible,
  type ActividadSii,
  type ProveedorSituacionTributaria,
} from './sii/proveedor-situacion-tributaria.js';
import {
  DATOS_CAMBIARON,
  SIN_RUT,
  SIN_SOLICITUD,
  SOLICITUD_EN_CURSO,
  SolicitudVerificacionService,
  YA_APROBADA,
  YA_ES_PROFESIONAL,
} from './solicitud-verificacion.service.js';

const CODIGO = '5f1d9c1e-7a3b-4c52-9d8e-0a1b2c3d4e5f';
const RUT = '12345678-5';

const PELUQUERIA: ActividadSii = {
  codigo: '960200',
  nombre: 'ACTIVIDADES DE PELUQUERIA Y OTROS TRATAMIENTOS DE BELLEZA',
  fechaInicio: '2020-01-15',
};
const OTRO_GIRO: ActividadSii = {
  codigo: '471100',
  nombre: 'VENTA AL POR MENOR EN COMERCIOS NO ESPECIALIZADOS',
  fechaInicio: '2019-03-01',
};

const cuenta = (cambios: object = {}) => ({
  id: 7,
  rol: 'cliente',
  rut: RUT,
  email: 'marcela@correo.cl',
  nombre: 'Marcela',
  apellido: 'Soto',
  solicitudesPresentadas: [],
  ...cambios,
});

const solicitudGuardada = (cambios: object = {}) => ({
  estado: 'pendiente',
  fechaSolicitud: new Date('2026-11-02T18:00:00.000Z'),
  fechaResolucion: null,
  motivoRechazo: null,
  antecedentes: [],
  ...cambios,
});

const crearDb = () => {
  const db = {
    usuario: {
      findUnique: vi.fn().mockResolvedValue(cuenta()),
      findUniqueOrThrow: vi.fn().mockResolvedValue(cuenta()),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    solicitudVerificacion: {
      create: vi.fn().mockResolvedValue(solicitudGuardada()),
      findFirst: vi.fn().mockResolvedValue(solicitudGuardada()),
    },
    notificacion: {
      create: vi.fn().mockResolvedValue({ id: 90 }),
    },
    // El bloqueo de la cuenta (`bloquearCuenta`) devuelve su id
    $queryRaw: vi.fn().mockResolvedValue([{ id: 7 }]),
    $transaction: vi.fn(),
    /** Se llama cuando la transacción simulada termina bien: marca el commit. */
    commit: vi.fn(),
  };
  db.$transaction.mockImplementation(
    async (fn: (t: typeof db) => Promise<unknown>) => {
      const resultado = await fn(db);
      db.commit();
      return resultado;
    },
  );
  return db;
};

describe('SolicitudVerificacionService', () => {
  let db: ReturnType<typeof crearDb>;
  let proveedor: {
    nombre: string;
    consultar: ReturnType<typeof vi.fn>;
  };
  let correos: { add: ReturnType<typeof vi.fn> };
  let servicio: SolicitudVerificacionService;

  /** Lo que se guardó en la solicitud. */
  const guardado = () =>
    (
      db.solicitudVerificacion.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T18:00:00.000Z'));
    db = crearDb();
    proveedor = {
      nombre: 'khipu',
      consultar: vi.fn().mockResolvedValue({
        actividades: [PELUQUERIA],
        contribuyente: 'SOTO PEREZ MARCELA ANDREA',
        operacion: 'op-1',
      }),
    };
    correos = { add: vi.fn().mockResolvedValue({}) };
    servicio = new SolicitudVerificacionService(
      db as unknown as PrismaService,
      proveedor as unknown as ProveedorSituacionTributaria,
      correos as unknown as Queue,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('E10-H1 · aprobación automática: el giro 960200 vigente deja la solicitud aprobada y guarda la consulta', async () => {
    db.solicitudVerificacion.create.mockResolvedValue(
      solicitudGuardada({
        estado: 'aprobada',
        fechaResolucion: new Date('2026-11-02T18:00:00.000Z'),
      }),
    );

    const respuesta = await servicio.solicitar(CODIGO);

    expect(proveedor.consultar).toHaveBeenCalledWith(RUT);
    expect(guardado()).toEqual({
      solicitanteId: 7,
      estado: 'aprobada',
      fechaResolucion: new Date('2026-11-02T18:00:00.000Z'),
      fechaConsultaSii: new Date('2026-11-02T18:00:00.000Z'),
      resultadoConsultaSii: 'aprobado',
      girosSii: [
        {
          codigo: '960200',
          nombre: PELUQUERIA.nombre,
          fechaInicio: '2020-01-15',
        },
      ],
      proveedorConsultaSii: 'khipu',
      operacionConsultaSii: 'op-1',
    });
    expect(guardado()).not.toHaveProperty('resolutorId');
    expect(respuesta).toEqual({
      estado: 'aprobada',
      fechaSolicitud: '2026-11-02T18:00:00.000Z',
      fechaResolucion: '2026-11-02T18:00:00.000Z',
      motivoRechazo: null,
      requiereDocumentos: false,
      documentos: [],
    });
  });

  it('SCRUM-163 · giro 960200 a nombre de otra persona: no aprueba, queda pendiente con nombre_no_coincide', async () => {
    proveedor.consultar.mockResolvedValue({
      actividades: [PELUQUERIA],
      contribuyente: 'ROJAS DIAZ PEDRO ANTONIO',
      operacion: 'op-3',
    });

    const respuesta = await servicio.solicitar(CODIGO);

    expect(guardado()).toMatchObject({
      estado: 'pendiente',
      fechaResolucion: null,
      resultadoConsultaSii: 'nombre_no_coincide',
    });
    expect(db.usuario.updateMany).not.toHaveBeenCalled();
    expect(correos.add).not.toHaveBeenCalled();
    expect(respuesta.requiereDocumentos).toBe(true);
  });

  it('SCRUM-163 · giro 960200 sin nombre del contribuyente: no aprueba, queda pendiente con nombre_no_coincide', async () => {
    proveedor.consultar.mockResolvedValue({
      actividades: [PELUQUERIA],
      contribuyente: null,
      operacion: null,
    });

    await servicio.solicitar(CODIGO);

    expect(guardado()).toMatchObject({
      estado: 'pendiente',
      resultadoConsultaSii: 'nombre_no_coincide',
    });
  });

  it('E10-H1 · sin inicio de actividades: no rechaza, deja la solicitud pendiente y pide documentos', async () => {
    proveedor.consultar.mockResolvedValue({ actividades: [], operacion: null });

    const respuesta = await servicio.solicitar(CODIGO);

    expect(guardado()).toMatchObject({
      estado: 'pendiente',
      fechaResolucion: null,
      resultadoConsultaSii: 'sin_inicio_actividades',
      girosSii: [],
    });
    expect(respuesta).toEqual({
      estado: 'pendiente',
      fechaSolicitud: '2026-11-02T18:00:00.000Z',
      fechaResolucion: null,
      motivoRechazo: null,
      requiereDocumentos: true,
      documentos: [],
    });
  });

  it('E10-H1 · otro giro: no rechaza, deja la solicitud pendiente y guarda los giros recibidos', async () => {
    proveedor.consultar.mockResolvedValue({
      actividades: [OTRO_GIRO],
      operacion: 'op-2',
    });

    const respuesta = await servicio.solicitar(CODIGO);

    expect(guardado()).toMatchObject({
      estado: 'pendiente',
      resultadoConsultaSii: 'otro_giro',
      girosSii: [
        {
          codigo: '471100',
          nombre: OTRO_GIRO.nombre,
          fechaInicio: '2019-03-01',
        },
      ],
      operacionConsultaSii: 'op-2',
    });
    expect(respuesta.requiereDocumentos).toBe(true);
  });

  it('E10-H1 · consulta no disponible: no bloquea, registra la falla y pide documentos', async () => {
    proveedor.consultar.mockRejectedValue(
      new ConsultaSiiNoDisponible('Khipu respondió 500.'),
    );

    const respuesta = await servicio.solicitar(CODIGO);

    const datos = guardado();
    expect(datos).toMatchObject({
      estado: 'pendiente',
      fechaResolucion: null,
      resultadoConsultaSii: 'no_disponible',
      proveedorConsultaSii: 'khipu',
      operacionConsultaSii: null,
    });
    expect(datos.girosSii).toBeUndefined();
    expect(respuesta.requiereDocumentos).toBe(true);
  });

  it('E10-H1 · consulta no disponible: un error inesperado del proveedor tampoco bloquea al cliente', async () => {
    proveedor.consultar.mockRejectedValue(new TypeError('algo raro'));

    const respuesta = await servicio.solicitar(CODIGO);

    expect(guardado()).toMatchObject({ resultadoConsultaSii: 'no_disponible' });
    expect(respuesta.requiereDocumentos).toBe(true);
  });

  it('E10-H1 · cuenta sin RUT: responde 409 que pide registrarlo y no consulta ni guarda nada', async () => {
    db.usuario.findUnique.mockResolvedValue(cuenta({ rut: null }));

    await expect(servicio.solicitar(CODIGO)).rejects.toThrow(
      new ConflictException(SIN_RUT),
    );
    expect(proveedor.consultar).not.toHaveBeenCalled();
    expect(db.solicitudVerificacion.create).not.toHaveBeenCalled();
  });

  it('E10-H1 · cuenta que ya es profesional: responde 409 sin consultar', async () => {
    db.usuario.findUnique.mockResolvedValue(cuenta({ rol: 'profesional' }));

    await expect(servicio.solicitar(CODIGO)).rejects.toThrow(
      new ConflictException(YA_ES_PROFESIONAL),
    );
    expect(proveedor.consultar).not.toHaveBeenCalled();
  });

  it('E10-H1 · solicitud en curso: pendiente o en revisión manual responde 409 sin consultar', async () => {
    db.usuario.findUnique.mockResolvedValue(
      cuenta({ solicitudesPresentadas: [{ estado: 'revision_manual' }] }),
    );

    await expect(servicio.solicitar(CODIGO)).rejects.toThrow(
      new ConflictException(SOLICITUD_EN_CURSO),
    );
    expect(proveedor.consultar).not.toHaveBeenCalled();
  });

  it('E10-H1 · solicitud ya aprobada: responde 409 sin consultar de nuevo', async () => {
    db.usuario.findUnique.mockResolvedValue(
      cuenta({ solicitudesPresentadas: [{ estado: 'aprobada' }] }),
    );

    await expect(servicio.solicitar(CODIGO)).rejects.toThrow(
      new ConflictException(YA_APROBADA),
    );
    expect(proveedor.consultar).not.toHaveBeenCalled();
  });

  it('E10-H1 · nueva solicitud tras un rechazo: solo bloquean la abierta y la aprobada, así que consulta de nuevo', async () => {
    await servicio.solicitar(CODIGO);

    const { select } = db.usuario.findUnique.mock.calls[0][0] as {
      select: {
        solicitudesPresentadas: { where: { estado: { in: string[] } } };
      };
    };
    expect(select.solicitudesPresentadas.where.estado.in).toEqual([
      'pendiente',
      'revision_manual',
      'aprobada',
    ]);
    expect(proveedor.consultar).toHaveBeenCalledTimes(1);
  });

  it('E10-H1 · cuenta inexistente: responde 404', async () => {
    db.usuario.findUnique.mockResolvedValue(null);

    await expect(servicio.solicitar(CODIGO)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('E10-H1 · dos envíos a la vez: con la cuenta bloqueada, el segundo ve la solicitud abierta y responde 409', async () => {
    db.usuario.findUniqueOrThrow.mockResolvedValue(
      cuenta({ solicitudesPresentadas: [{ estado: 'pendiente' }] }),
    );

    await expect(servicio.solicitar(CODIGO)).rejects.toThrow(
      new ConflictException(SOLICITUD_EN_CURSO),
    );
    expect(db.solicitudVerificacion.create).not.toHaveBeenCalled();
  });

  it('E10-H1 · bloqueo de la cuenta: se toma antes de leerla de nuevo, y la consulta no ocurre dentro de la transacción', async () => {
    const orden: string[] = [];
    proveedor.consultar.mockImplementation(() => {
      orden.push('consulta');
      return Promise.resolve({ actividades: [], operacion: null });
    });
    db.$transaction.mockImplementation(
      (fn: (t: typeof db) => Promise<unknown>) => {
        orden.push('transaccion');
        return fn(db);
      },
    );
    db.$queryRaw.mockImplementation(() => {
      orden.push('bloqueo');
      return Promise.resolve([{ id: 7 }]);
    });
    db.usuario.findUniqueOrThrow.mockImplementation(() => {
      orden.push('lectura');
      return Promise.resolve(cuenta());
    });

    await servicio.solicitar(CODIGO);

    expect(orden).toEqual(['consulta', 'transaccion', 'bloqueo', 'lectura']);
  });

  it('E10-H1 · el RUT cambió durante la consulta: responde 409 y no guarda una consulta de otro RUT', async () => {
    db.usuario.findUniqueOrThrow.mockResolvedValue(
      cuenta({ rut: '7654321-6' }),
    );

    await expect(servicio.solicitar(CODIGO)).rejects.toThrow(
      new ConflictException(DATOS_CAMBIARON),
    );
    expect(db.solicitudVerificacion.create).not.toHaveBeenCalled();
  });

  it('E10-H1 · falla la base: el error sube tal cual', async () => {
    db.solicitudVerificacion.create.mockRejectedValue(new Error('base caída'));

    await expect(servicio.solicitar(CODIGO)).rejects.toThrow('base caída');
    expect(correos.add).not.toHaveBeenCalled();
  });

  describe('E10-H4 · aprobación automática', () => {
    it('E10-H4 · cambio a profesional: la aprobación automática cambia el rol de la cuenta en la misma transacción, solo si sigue activa y cliente', async () => {
      await servicio.solicitar(CODIGO);

      expect(db.usuario.updateMany).toHaveBeenCalledWith({
        where: { id: 7, rol: 'cliente', activo: true },
        data: { rol: 'profesional' },
      });
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.usuario.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        db.commit.mock.invocationCallOrder[0],
      );
    });

    it('E10-H4 · correo de aprobación: registra la NOTIFICACION pendiente en la transacción y encola el correo después del commit', async () => {
      await servicio.solicitar(CODIGO);

      expect(db.notificacion.create).toHaveBeenCalledWith({
        data: {
          usuarioId: 7,
          tipo: 'verificacion_aprobada',
          asunto: ASUNTO_VERIFICACION_APROBADA,
          estadoEnvio: 'pendiente',
        },
        select: { id: true },
      });
      expect(correos.add).toHaveBeenCalledWith(
        'verificacion-aprobada',
        {
          notificacionId: 90,
          destinatario: 'marcela@correo.cl',
          nombre: 'Marcela',
        },
        expect.objectContaining({ jobId: 'correo-90', priority: 1 }),
      );
      expect(correos.add.mock.invocationCallOrder[0]).toBeGreaterThan(
        db.commit.mock.invocationCallOrder[0],
      );
    });

    it('E10-H4 · correo de aprobación: si Redis no responde, la solicitud igual queda aprobada (RNF-32)', async () => {
      correos.add.mockRejectedValue(new Error('Redis caído'));
      db.solicitudVerificacion.create.mockResolvedValue(
        solicitudGuardada({ estado: 'aprobada' }),
      );

      await expect(servicio.solicitar(CODIGO)).resolves.toMatchObject({
        estado: 'aprobada',
      });
    });

    it('E10-H4 · si la cuenta dejó de ser cliente o activa justo antes, 409 y no se registra el correo', async () => {
      db.usuario.updateMany.mockResolvedValue({ count: 0 });

      await expect(servicio.solicitar(CODIGO)).rejects.toThrow(
        new ConflictException(CUENTA_NO_APROBABLE),
      );
      expect(db.notificacion.create).not.toHaveBeenCalled();
      expect(correos.add).not.toHaveBeenCalled();
    });

    it('E10-H4 · sin aprobación (pide documentos) no cambia el rol ni envía el correo', async () => {
      proveedor.consultar.mockResolvedValue({
        actividades: [OTRO_GIRO],
        operacion: 'op-2',
      });

      await servicio.solicitar(CODIGO);

      expect(db.usuario.updateMany).not.toHaveBeenCalled();
      expect(db.notificacion.create).not.toHaveBeenCalled();
      expect(correos.add).not.toHaveBeenCalled();
    });
  });

  describe('ver mi solicitud', () => {
    it('E10-H1 · solicitud rechazada: muestra el estado, el motivo y las fechas, sin pedir documentos', async () => {
      db.solicitudVerificacion.findFirst.mockResolvedValue(
        solicitudGuardada({
          estado: 'rechazada',
          fechaResolucion: new Date('2026-11-03T12:00:00.000Z'),
          motivoRechazo: 'El documento no se lee.',
        }),
      );

      const respuesta = await servicio.verMiSolicitud(CODIGO);

      expect(respuesta).toEqual({
        estado: 'rechazada',
        fechaSolicitud: '2026-11-02T18:00:00.000Z',
        fechaResolucion: '2026-11-03T12:00:00.000Z',
        motivoRechazo: 'El documento no se lee.',
        requiereDocumentos: false,
        documentos: [],
      });
    });

    it('E10-H1 · solo la rechazada muestra motivo, y solo la pendiente pide documentos', async () => {
      for (const [estado, requiere] of [
        ['pendiente', true],
        ['revision_manual', false],
        ['aprobada', false],
      ] as const) {
        db.solicitudVerificacion.findFirst.mockResolvedValue(
          solicitudGuardada({ estado, motivoRechazo: 'residuo' }),
        );

        const respuesta = await servicio.verMiSolicitud(CODIGO);

        expect(respuesta.motivoRechazo).toBeNull();
        expect(respuesta.requiereDocumentos).toBe(requiere);
      }
    });

    it('E10-H1 · busca la más reciente de la cuenta y nunca pide la consulta al SII, el puntaje ni al resolutor', async () => {
      await servicio.verMiSolicitud(CODIGO);

      expect(db.solicitudVerificacion.findFirst).toHaveBeenCalledWith({
        where: { solicitante: { codigoPublico: CODIGO } },
        orderBy: { id: 'desc' },
        select: {
          estado: true,
          fechaSolicitud: true,
          fechaResolucion: true,
          motivoRechazo: true,
          antecedentes: {
            select: { tipo: true, nombreArchivo: true },
            orderBy: { id: 'asc' },
          },
        },
      });
    });

    it('E10-H1 · cuenta sin solicitudes: responde 404', async () => {
      db.solicitudVerificacion.findFirst.mockResolvedValue(null);

      await expect(servicio.verMiSolicitud(CODIGO)).rejects.toThrow(
        new NotFoundException(SIN_SOLICITUD),
      );
    });
  });
});
