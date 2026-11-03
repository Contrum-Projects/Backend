import { GoneException, NotFoundException } from '@nestjs/common';
import type { AlmacenArchivos } from '../../almacen/almacen-archivos.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  ConsultaVerificacionService,
  DOCUMENTO_NO_EXISTE,
  SEGUNDOS_ENLACE_DOCUMENTO,
} from './consulta-verificacion.service.js';
import { SIN_SOLICITUD_CUENTA } from './revision-verificacion.service.js';

const CUENTA = '5f1d9c1e-7a3b-4c52-9d8e-0a1b2c3d4e5f';
const AHORA = new Date('2026-11-03T15:00:00.000Z');

const cliente = {
  codigoPublico: CUENTA,
  nombre: 'Marcela',
  apellido: 'Soto',
  rut: '11.222.338-K',
  email: 'marcela@prueba.cl',
  telefono: '+56911112222',
};

const resolutor = {
  codigoPublico: '3f0c2a52-0b9e-4c55-9d0e-6a3a4f6d1b2c',
  nombre: 'Rosa',
  apellido: 'Pérez',
};

const giros = [
  { codigo: '471100', nombre: 'VENTA AL POR MENOR', fechaInicio: '2019-03-01' },
];

const solicitudActual = {
  estado: 'revision_manual',
  fechaSolicitud: new Date('2026-11-02T18:00:00.000Z'),
  fechaResolucion: null,
  motivoRechazo: null,
  fechaConsultaSii: new Date('2026-11-02T18:00:01.000Z'),
  resultadoConsultaSii: 'otro_giro',
  girosSii: giros,
  resolutor: null,
  antecedentes: [
    {
      tipo: 'titulo',
      nombreArchivo: 'título.pdf',
      fechaEliminacionArchivo: null,
    },
    {
      tipo: 'certificado',
      nombreArchivo: 'certificado.png',
      fechaEliminacionArchivo: null,
    },
  ],
};

const solicitudAnterior = {
  estado: 'rechazada',
  fechaSolicitud: new Date('2026-10-20T12:00:00.000Z'),
  fechaResolucion: new Date('2026-10-21T12:00:00.000Z'),
  motivoRechazo: 'El certificado adjunto no es legible.',
  fechaConsultaSii: new Date('2026-10-20T12:00:01.000Z'),
  resultadoConsultaSii: 'sin_inicio_actividades',
  girosSii: [],
  resolutor,
  antecedentes: [],
};

describe('ConsultaVerificacionService', () => {
  let db: {
    usuario: { findUnique: ReturnType<typeof vi.fn> };
    solicitudVerificacion: {
      count: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
  let almacen: { urlTemporal: ReturnType<typeof vi.fn> };
  let servicio: ConsultaVerificacionService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AHORA);
    db = {
      usuario: { findUnique: vi.fn() },
      solicitudVerificacion: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn(),
      },
    };
    almacen = {
      urlTemporal: vi.fn().mockResolvedValue('https://almacen.prueba/firmado'),
    };
    servicio = new ConsultaVerificacionService(
      db as unknown as PrismaService,
      almacen as unknown as AlmacenArchivos,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('E10-H7 · listado: solo las solicitudes en revisión manual, de la más antigua a la más reciente, con el motivo de cada una', async () => {
    db.solicitudVerificacion.count.mockResolvedValue(3);
    db.solicitudVerificacion.findMany.mockResolvedValue(
      ['sin_inicio_actividades', 'otro_giro', 'no_disponible'].map(
        (resultadoConsultaSii, indice) => ({
          fechaSolicitud: new Date(`2026-11-0${indice + 1}T12:00:00.000Z`),
          resultadoConsultaSii,
          solicitante: { ...cliente, codigoPublico: `cuenta-${indice}` },
        }),
      ),
    );

    const respuesta = await servicio.listar({});

    expect(db.solicitudVerificacion.count).toHaveBeenCalledWith({
      where: { estado: 'revision_manual' },
    });
    expect(db.solicitudVerificacion.findMany.mock.calls[0][0]).toMatchObject({
      where: { estado: 'revision_manual' },
      orderBy: [{ fechaSolicitud: 'asc' }, { id: 'asc' }],
      skip: 0,
      take: 20,
    });
    expect(respuesta).toEqual({
      items: [
        {
          codigoPublicoCuenta: 'cuenta-0',
          nombre: 'Marcela',
          apellido: 'Soto',
          rut: '11.222.338-K',
          fechaEnvio: '2026-11-01T12:00:00.000Z',
          motivoRevision: 'sin_inicio_actividades',
        },
        expect.objectContaining({
          codigoPublicoCuenta: 'cuenta-1',
          motivoRevision: 'otro_giro',
        }),
        expect.objectContaining({
          codigoPublicoCuenta: 'cuenta-2',
          motivoRevision: 'no_disponible',
        }),
      ],
      total: 3,
      pagina: 1,
      limite: 20,
    });
  });

  it('E10-H7 · listado: la página pedida salta las anteriores y no devuelve nada si no hay solicitudes', async () => {
    const respuesta = await servicio.listar({ pagina: 3, limite: 5 });

    expect(db.solicitudVerificacion.findMany.mock.calls[0][0]).toMatchObject({
      skip: 10,
      take: 5,
    });
    expect(respuesta).toEqual({ items: [], total: 0, pagina: 3, limite: 5 });
  });

  it('E10-H7 · detalle: datos del cliente, motivo, resultado del SII con sus giros, documentos numerados y solicitudes anteriores con su resolución', async () => {
    db.usuario.findUnique.mockResolvedValue({
      ...cliente,
      solicitudesPresentadas: [solicitudActual, solicitudAnterior],
    });

    const detalle = await servicio.detalle(CUENTA);

    expect(db.usuario.findUnique.mock.calls[0][0]).toMatchObject({
      where: { codigoPublico: CUENTA },
    });
    expect(detalle).toEqual({
      cliente,
      solicitud: {
        estado: 'revision_manual',
        fechaSolicitud: '2026-11-02T18:00:00.000Z',
        fechaResolucion: null,
        motivoRechazo: null,
        resolutor: null,
        motivoRevision: 'otro_giro',
        consultaSii: {
          fecha: '2026-11-02T18:00:01.000Z',
          resultado: 'otro_giro',
          giros,
        },
        documentos: [
          {
            numero: 1,
            tipo: 'titulo',
            nombreArchivo: 'título.pdf',
            fechaEliminacion: null,
          },
          {
            numero: 2,
            tipo: 'certificado',
            nombreArchivo: 'certificado.png',
            fechaEliminacion: null,
          },
        ],
      },
      solicitudesAnteriores: [
        {
          estado: 'rechazada',
          fechaSolicitud: '2026-10-20T12:00:00.000Z',
          fechaResolucion: '2026-10-21T12:00:00.000Z',
          motivoRechazo: 'El certificado adjunto no es legible.',
          resolutor,
        },
      ],
    });
    // Ni la ubicación de los archivos ni su hash salen en el detalle
    expect(JSON.stringify(detalle)).not.toContain('ubicacion');
    expect(JSON.stringify(detalle)).not.toContain('hash');
  });

  it('E10-H7 · detalle: la consulta al SII que falló se ve como no disponible, sin giros', async () => {
    db.usuario.findUnique.mockResolvedValue({
      ...cliente,
      solicitudesPresentadas: [
        {
          ...solicitudActual,
          resultadoConsultaSii: 'no_disponible',
          girosSii: null,
        },
      ],
    });

    const { solicitud } = await servicio.detalle(CUENTA);

    expect(solicitud.motivoRevision).toBe('no_disponible');
    expect(solicitud.consultaSii).toEqual({
      fecha: '2026-11-02T18:00:01.000Z',
      resultado: 'no_disponible',
      giros: null,
    });
  });

  it('E10-H7 · detalle de una solicitud ya resuelta: con documentos eliminados indica la fecha de eliminación', async () => {
    db.usuario.findUnique.mockResolvedValue({
      ...cliente,
      solicitudesPresentadas: [
        {
          ...solicitudActual,
          estado: 'aprobada',
          fechaResolucion: new Date('2026-11-02T20:00:00.000Z'),
          resolutor,
          antecedentes: [
            {
              tipo: 'titulo',
              nombreArchivo: 'título.pdf',
              fechaEliminacionArchivo: new Date('2026-12-02T09:00:00.000Z'),
            },
          ],
        },
      ],
    });

    const { solicitud, solicitudesAnteriores } = await servicio.detalle(CUENTA);

    expect(solicitud.estado).toBe('aprobada');
    expect(solicitud.resolutor).toEqual(resolutor);
    expect(solicitud.documentos).toEqual([
      {
        numero: 1,
        tipo: 'titulo',
        nombreArchivo: 'título.pdf',
        fechaEliminacion: '2026-12-02T09:00:00.000Z',
      },
    ]);
    expect(solicitudesAnteriores).toEqual([]);
  });

  it('E10-H7 · detalle: el motivo del rechazo solo sale en una solicitud rechazada', async () => {
    db.usuario.findUnique.mockResolvedValue({
      ...cliente,
      solicitudesPresentadas: [
        { ...solicitudActual, motivoRechazo: 'texto suelto' },
      ],
    });

    const { solicitud } = await servicio.detalle(CUENTA);

    expect(solicitud.motivoRechazo).toBeNull();
  });

  it('E10-H7 · detalle: una cuenta que no existe o nunca solicitó responde 404', async () => {
    db.usuario.findUnique.mockResolvedValueOnce(null);
    await expect(servicio.detalle(CUENTA)).rejects.toThrow(
      new NotFoundException(SIN_SOLICITUD_CUENTA),
    );

    db.usuario.findUnique.mockResolvedValueOnce({
      ...cliente,
      solicitudesPresentadas: [],
    });
    await expect(servicio.detalle(CUENTA)).rejects.toThrow(
      new NotFoundException(SIN_SOLICITUD_CUENTA),
    );
  });

  it('E10-H7 · documento: entrega un enlace temporal que vence en 60 segundos, con el nombre del archivo', async () => {
    db.solicitudVerificacion.findFirst.mockResolvedValue({
      antecedentes: [
        {
          tipo: 'titulo',
          nombreArchivo: 'título.pdf',
          ubicacionArchivo: 'verificaciones/7/a.pdf',
          fechaEliminacionArchivo: null,
        },
        {
          tipo: 'certificado',
          nombreArchivo: 'certificado.png',
          ubicacionArchivo: 'verificaciones/7/b.png',
          fechaEliminacionArchivo: null,
        },
      ],
    });

    const enlace = await servicio.enlaceDocumento(CUENTA, 2);

    expect(db.solicitudVerificacion.findFirst.mock.calls[0][0]).toMatchObject({
      where: { solicitante: { codigoPublico: CUENTA } },
      orderBy: { id: 'desc' },
    });
    expect(almacen.urlTemporal).toHaveBeenCalledWith('verificaciones/7/b.png', {
      segundos: 60,
      nombreArchivo: 'certificado.png',
    });
    expect(SEGUNDOS_ENLACE_DOCUMENTO).toBe(60);
    expect(enlace).toEqual({
      url: 'https://almacen.prueba/firmado',
      venceEn: '2026-11-03T15:01:00.000Z',
      tipo: 'certificado',
      nombreArchivo: 'certificado.png',
    });
  });

  it('E10-H7 · documento eliminado: responde 410 con la fecha y no entrega enlace', async () => {
    db.solicitudVerificacion.findFirst.mockResolvedValue({
      antecedentes: [
        {
          tipo: 'titulo',
          nombreArchivo: 'título.pdf',
          ubicacionArchivo: 'verificaciones/7/a.pdf',
          fechaEliminacionArchivo: new Date('2026-12-02T09:00:00.000Z'),
        },
      ],
    });

    const intento = servicio.enlaceDocumento(CUENTA, 1);

    await expect(intento).rejects.toThrow(
      new GoneException('El documento se eliminó el 02-12-2026.'),
    );
    expect(almacen.urlTemporal).not.toHaveBeenCalled();
  });

  it('E10-H7 · documento: un número que no existe (0, negativo o de más) o una cuenta sin solicitudes responde 404', async () => {
    db.solicitudVerificacion.findFirst.mockResolvedValue({
      antecedentes: [
        {
          tipo: 'titulo',
          nombreArchivo: 'título.pdf',
          ubicacionArchivo: 'verificaciones/7/a.pdf',
          fechaEliminacionArchivo: null,
        },
      ],
    });
    for (const numero of [0, -1, 2, 99]) {
      await expect(servicio.enlaceDocumento(CUENTA, numero)).rejects.toThrow(
        new NotFoundException(DOCUMENTO_NO_EXISTE),
      );
    }

    db.solicitudVerificacion.findFirst.mockResolvedValue(null);
    await expect(servicio.enlaceDocumento(CUENTA, 1)).rejects.toThrow(
      new NotFoundException(SIN_SOLICITUD_CUENTA),
    );
    expect(almacen.urlTemporal).not.toHaveBeenCalled();
  });
});
