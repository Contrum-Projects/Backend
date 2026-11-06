import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { AlmacenArchivos } from '../../almacen/almacen-archivos.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  type ArchivoAntecedente,
  DOCUMENTO_MUY_GRANDE,
  DOCUMENTOS_YA_ENVIADOS,
  DocumentosVerificacionService,
  documentoNoValido,
  SIN_ARCHIVOS,
  SOLICITUD_RECHAZADA,
  TIPOS_NO_COINCIDEN,
} from './documentos-verificacion.service.js';
import {
  SIN_SOLICITUD,
  YA_APROBADA,
} from './solicitud-verificacion.service.js';

const CODIGO = '5f1d9c1e-7a3b-4c52-9d8e-0a1b2c3d4e5f';

const archivo = (
  contenido: string | number[],
  originalname = 'documento.pdf',
): ArchivoAntecedente => {
  const buffer = Buffer.from(contenido as string);
  return { buffer, size: buffer.length, originalname };
};
const pdf = (nombre = 'titulo.pdf') => archivo('%PDF-1.7\n...', nombre);
const jpg = (nombre = 'certificado.jpg') =>
  archivo([0xff, 0xd8, 0xff, 0xe0, 0, 0], nombre);

const solicitudActualizada = (cambios: object = {}) => ({
  estado: 'revision_manual',
  fechaSolicitud: new Date('2026-11-02T18:00:00.000Z'),
  fechaResolucion: null,
  motivoRechazo: null,
  antecedentes: [{ tipo: 'titulo', nombreArchivo: 'titulo.pdf' }],
  ...cambios,
});

const crearDb = () => {
  const db = {
    solicitudVerificacion: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: 3, estado: 'pendiente', solicitanteId: 7 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ estado: 'pendiente' }),
      update: vi.fn().mockResolvedValue(solicitudActualizada()),
    },
    // El bloqueo de la cuenta (`bloquearCuenta`) devuelve su id
    $queryRaw: vi.fn().mockResolvedValue([{ id: 7 }]),
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((fn: (t: typeof db) => Promise<unknown>) =>
    fn(db),
  );
  return db;
};

describe('DocumentosVerificacionService', () => {
  let db: ReturnType<typeof crearDb>;
  let almacen: {
    guardar: ReturnType<typeof vi.fn>;
    eliminar: ReturnType<typeof vi.fn>;
  };
  let servicio: DocumentosVerificacionService;

  const adjuntar = (
    tipos: string[] = ['titulo'],
    archivos: ArchivoAntecedente[] = [pdf()],
  ) => servicio.adjuntar(CODIGO, { tipos }, archivos);

  /** Los datos con que se actualizó la solicitud. */
  const actualizado = () =>
    (
      db.solicitudVerificacion.update.mock.calls[0][0] as {
        where: { id: number };
        data: {
          estado: string;
          antecedentes: { create: Record<string, unknown>[] };
        };
      }
    ).data;

  beforeEach(() => {
    db = crearDb();
    almacen = {
      guardar: vi.fn().mockResolvedValue(undefined),
      eliminar: vi.fn().mockResolvedValue(undefined),
    };
    servicio = new DocumentosVerificacionService(
      db as unknown as PrismaService,
      almacen as unknown as AlmacenArchivos,
    );
  });

  it('E10-H2 · documentos enviados: sube cada documento privado, pasa la solicitud a revisión manual y guarda el hash, sin OCR', async () => {
    const titulo = pdf('titulo.pdf');
    const certificado = jpg('certificado.jpg');
    db.solicitudVerificacion.update.mockResolvedValue(
      solicitudActualizada({
        antecedentes: [
          { tipo: 'titulo', nombreArchivo: 'titulo.pdf' },
          { tipo: 'certificado', nombreArchivo: 'certificado.jpg' },
        ],
      }),
    );

    const respuesta = await adjuntar(
      ['titulo', 'certificado'],
      [titulo, certificado],
    );

    expect(respuesta).toEqual({
      estado: 'revision_manual',
      fechaSolicitud: '2026-11-02T18:00:00.000Z',
      fechaResolucion: null,
      motivoRechazo: null,
      requiereDocumentos: false,
      documentos: [
        { tipo: 'titulo', nombreArchivo: 'titulo.pdf' },
        { tipo: 'certificado', nombreArchivo: 'certificado.jpg' },
      ],
    });
    expect(almacen.guardar).toHaveBeenCalledTimes(2);
    expect(almacen.guardar).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^verificaciones\/7\/[0-9a-f-]{36}\.pdf$/),
      titulo.buffer,
      'application/pdf',
      true,
    );
    expect(almacen.guardar).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^verificaciones\/7\/[0-9a-f-]{36}\.jpg$/),
      certificado.buffer,
      'image/jpeg',
      true,
    );
    const datos = actualizado();
    expect(
      (
        db.solicitudVerificacion.update.mock.calls[0][0] as {
          where: { id: number };
        }
      ).where,
    ).toEqual({ id: 3 });
    expect(datos.estado).toBe('revision_manual');
    expect(datos.antecedentes.create).toEqual([
      {
        tipo: 'titulo',
        nombreArchivo: 'titulo.pdf',
        ubicacionArchivo: almacen.guardar.mock.calls[0][0],
        hashArchivo: createHash('sha256').update(titulo.buffer).digest('hex'),
        estadoOcr: 'no_aplica',
      },
      {
        tipo: 'certificado',
        nombreArchivo: 'certificado.jpg',
        ubicacionArchivo: almacen.guardar.mock.calls[1][0],
        hashArchivo: createHash('sha256')
          .update(certificado.buffer)
          .digest('hex'),
        estadoOcr: 'no_aplica',
      },
    ]);
  });

  it('E10-H2 · sin documentos: pide adjuntar al menos uno y no toca el almacén ni la base', async () => {
    await expect(servicio.adjuntar(CODIGO, { tipos: [] }, [])).rejects.toThrow(
      new BadRequestException(SIN_ARCHIVOS),
    );
    await expect(
      servicio.adjuntar(CODIGO, { tipos: ['titulo'] }, undefined),
    ).rejects.toThrow(new BadRequestException(SIN_ARCHIVOS));
    expect(almacen.guardar).not.toHaveBeenCalled();
    expect(db.solicitudVerificacion.findFirst).not.toHaveBeenCalled();
  });

  it('E10-H2 · más de 5 documentos: responde 400', async () => {
    const seis = Array.from({ length: 6 }, () => pdf());

    await expect(adjuntar(Array(6).fill('titulo'), seis)).rejects.toThrow(
      new BadRequestException(SIN_ARCHIVOS),
    );
    expect(almacen.guardar).not.toHaveBeenCalled();
  });

  it('E10-H2 · los tipos no coinciden con los archivos: responde 400', async () => {
    await expect(adjuntar(['titulo'], [pdf(), pdf()])).rejects.toThrow(
      new BadRequestException(TIPOS_NO_COINCIDEN),
    );
    await expect(adjuntar(['titulo', 'otro'], [pdf()])).rejects.toThrow(
      new BadRequestException(TIPOS_NO_COINCIDEN),
    );
    expect(almacen.guardar).not.toHaveBeenCalled();
  });

  it('E10-H2 · archivo que no es PDF, JPG ni PNG: responde 400 con su número, aunque diga ser .pdf', async () => {
    const falso = archivo('MZ ejecutable disfrazado', 'titulo.pdf');

    await expect(adjuntar(['titulo', 'otro'], [pdf(), falso])).rejects.toThrow(
      new BadRequestException(documentoNoValido(2)),
    );
    expect(almacen.guardar).not.toHaveBeenCalled();
  });

  it('E10-H2 · documento de más de 4 MB: responde 400 sin subir nada', async () => {
    const grande = { ...pdf(), size: 4 * 1024 * 1024 + 1 };

    await expect(adjuntar(['titulo'], [grande])).rejects.toThrow(
      new BadRequestException(DOCUMENTO_MUY_GRANDE),
    );
    expect(almacen.guardar).not.toHaveBeenCalled();
  });

  it('E10-H2 · nombre del archivo: conserva las tildes (multer lo entrega en latin1), quita la ruta del equipo y pone uno si viene vacío', async () => {
    const latin1 = (nombre: string) =>
      Buffer.from(nombre, 'utf8').toString('latin1');

    await adjuntar(
      ['titulo', 'certificado', 'otro'],
      [
        pdf(latin1('C:\\Mis documentos\\Título profesional.pdf')),
        pdf(latin1('/home/marcela/certificación.pdf')),
        pdf('  '),
      ],
    );

    expect(
      actualizado().antecedentes.create.map((a) => a.nombreArchivo),
    ).toEqual([
      'Título profesional.pdf',
      'certificación.pdf',
      'documento-3.pdf',
    ]);
  });

  it('E10-H2 · solicitud ya aprobada automáticamente: responde 409 y no guarda los documentos', async () => {
    db.solicitudVerificacion.findFirst.mockResolvedValue({
      id: 3,
      estado: 'aprobada',
      solicitanteId: 7,
    });

    await expect(adjuntar()).rejects.toThrow(
      new ConflictException(YA_APROBADA),
    );
    expect(almacen.guardar).not.toHaveBeenCalled();
    expect(db.solicitudVerificacion.update).not.toHaveBeenCalled();
  });

  it('E10-H2 · documentos ya enviados (revisión manual): responde 409 y no guarda otros', async () => {
    db.solicitudVerificacion.findFirst.mockResolvedValue({
      id: 3,
      estado: 'revision_manual',
      solicitanteId: 7,
    });

    await expect(adjuntar()).rejects.toThrow(
      new ConflictException(DOCUMENTOS_YA_ENVIADOS),
    );
    expect(almacen.guardar).not.toHaveBeenCalled();
  });

  it('E10-H2 · solicitud rechazada: responde 409 y pide enviar una nueva, que vuelve a aceptar documentos', async () => {
    db.solicitudVerificacion.findFirst.mockResolvedValue({
      id: 3,
      estado: 'rechazada',
      solicitanteId: 7,
    });

    await expect(adjuntar()).rejects.toThrow(
      new ConflictException(SOLICITUD_RECHAZADA),
    );

    db.solicitudVerificacion.findFirst.mockResolvedValue({
      id: 4,
      estado: 'pendiente',
      solicitanteId: 7,
    });
    await expect(adjuntar()).resolves.toMatchObject({
      estado: 'revision_manual',
    });
  });

  it('E10-H2 · cuenta sin solicitudes: responde 404', async () => {
    db.solicitudVerificacion.findFirst.mockResolvedValue(null);

    await expect(adjuntar()).rejects.toThrow(
      new NotFoundException(SIN_SOLICITUD),
    );
    expect(almacen.guardar).not.toHaveBeenCalled();
  });

  it('E10-H2 · busca la solicitud más reciente de la cuenta', async () => {
    await adjuntar();

    expect(db.solicitudVerificacion.findFirst).toHaveBeenCalledWith({
      where: { solicitante: { codigoPublico: CODIGO } },
      orderBy: { id: 'desc' },
      select: { id: true, estado: true, solicitanteId: true },
    });
  });

  it('E10-H2 · dos envíos a la vez: con la cuenta bloqueada, el segundo ve la solicitud ya en revisión, responde 409 y borra sus archivos', async () => {
    db.solicitudVerificacion.findUniqueOrThrow.mockResolvedValue({
      estado: 'revision_manual',
    });

    await expect(adjuntar()).rejects.toThrow(
      new ConflictException(DOCUMENTOS_YA_ENVIADOS),
    );
    expect(db.solicitudVerificacion.update).not.toHaveBeenCalled();
    expect(almacen.eliminar).toHaveBeenCalledTimes(1);
    expect(almacen.eliminar).toHaveBeenCalledWith(
      almacen.guardar.mock.calls[0][0],
    );
  });

  it('E10-H2 · bloqueo de la cuenta: se toma antes de leer la solicitud de nuevo y de actualizarla', async () => {
    const orden: string[] = [];
    db.$queryRaw.mockImplementation(() => {
      orden.push('bloqueo');
      return Promise.resolve([{ id: 7 }]);
    });
    db.solicitudVerificacion.findUniqueOrThrow.mockImplementation(() => {
      orden.push('lectura');
      return Promise.resolve({ estado: 'pendiente' });
    });
    db.solicitudVerificacion.update.mockImplementation(() => {
      orden.push('actualizacion');
      return Promise.resolve(solicitudActualizada());
    });

    await adjuntar();

    expect(orden).toEqual(['bloqueo', 'lectura', 'actualizacion']);
  });

  it('E10-H2 · falla la base: borra los archivos que ya había subido y el error sube tal cual', async () => {
    db.solicitudVerificacion.update.mockRejectedValue(new Error('base caída'));

    await expect(
      adjuntar(['titulo', 'certificado'], [pdf(), jpg()]),
    ).rejects.toThrow('base caída');
    expect(almacen.eliminar).toHaveBeenCalledTimes(2);
  });

  it('E10-H2 · falla el almacén al subir el segundo: borra el primero, responde 503 y no toca la solicitud', async () => {
    almacen.guardar
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('R2 no responde'));

    await expect(
      adjuntar(['titulo', 'certificado'], [pdf(), jpg()]),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(almacen.eliminar).toHaveBeenCalledTimes(1);
    expect(almacen.eliminar).toHaveBeenCalledWith(
      almacen.guardar.mock.calls[0][0],
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('E10-H2 · si tampoco se pueden borrar los archivos, el error original sigue siendo el que se responde', async () => {
    db.solicitudVerificacion.update.mockRejectedValue(new Error('base caída'));
    almacen.eliminar.mockRejectedValue(new Error('R2 no responde'));

    await expect(adjuntar()).rejects.toThrow('base caída');
  });
});
