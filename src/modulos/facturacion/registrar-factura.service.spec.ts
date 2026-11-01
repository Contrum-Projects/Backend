import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { hoyEnLaTienda } from '../../common/dominio/fechas.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { AlmacenArchivos } from '../../almacen/almacen-archivos.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  FACTURA_MUY_GRANDE,
  FECHA_FUTURA,
  folioRepetido,
  NO_ES_PDF,
  NO_PIDIO_FACTURA,
  PEDIDO_NO_PAGADO,
  RegistrarFacturaService,
  SIN_ARCHIVO,
  SIN_DATOS_FACTURACION,
  YA_TIENE_FACTURA,
} from './registrar-factura.service.js';

const CODIGO = 'AB12CD34EF56';
const PDF = { buffer: Buffer.from('%PDF-1.7\n...'), size: 12 };

const crearDb = () => {
  const db = {
    pedido: {
      findUnique: vi.fn().mockResolvedValue({
        id: 40,
        estadoActual: 'pagado',
        tipoDocumentoSolicitado: 'factura',
        datosFacturacionId: 3,
        montoNeto: 10000,
        montoIva: 1900,
        montoTotal: 11900,
        documentos: [],
      }),
    },
    $queryRaw: vi.fn().mockResolvedValue([
      {
        id: 40,
        estado: 'pagado',
        tipoDocumento: 'factura',
        datosFacturacionId: 3,
        montoNeto: 10000,
        montoIva: 1900,
        montoTotal: 11900,
      },
    ]),
    // Sin `where.folio` pregunta si el pedido ya tiene factura; con él, si el folio existe
    documentoTributario: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ folio: 4521, estado: 'emitido' }),
    },
    datosFacturacion: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        rut: '76123456-0',
        razonSocial: 'Peluquería Bella Ltda.',
        giro: 'Servicios de peluquería',
        direccion: 'Calle Falsa 123',
        comuna: { nombre: 'Concepción' },
      }),
    },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((fn: (t: typeof db) => Promise<unknown>) =>
    fn(db),
  );
  return db;
};

describe('RegistrarFacturaService', () => {
  let db: ReturnType<typeof crearDb>;
  let almacen: {
    guardar: ReturnType<typeof vi.fn>;
    eliminar: ReturnType<typeof vi.fn>;
  };
  let servicio: RegistrarFacturaService;

  const registrar = (
    dto = { folio: 4521 } as { folio: number; fechaEmision?: string },
    archivo = PDF,
  ) => servicio.registrar(CODIGO, dto, archivo);

  const pedidoPrevio = (cambios: object) =>
    db.pedido.findUnique.mockResolvedValue({
      id: 40,
      estadoActual: 'pagado',
      tipoDocumentoSolicitado: 'factura',
      datosFacturacionId: 3,
      montoNeto: 10000,
      montoIva: 1900,
      montoTotal: 11900,
      documentos: [],
      ...cambios,
    });

  beforeEach(() => {
    db = crearDb();
    almacen = {
      guardar: vi.fn().mockResolvedValue(undefined),
      eliminar: vi.fn().mockResolvedValue(undefined),
    };
    servicio = new RegistrarFacturaService(
      db as unknown as PrismaService,
      almacen as unknown as AlmacenArchivos,
    );
  });

  it('E9-H3 · pedido pagado que pidió factura: guarda el documento con el receptor y los montos del pedido, y el PDF privado en el almacén', async () => {
    const respuesta = await registrar({
      folio: 4521,
      fechaEmision: '2026-10-29',
    });

    expect(respuesta).toEqual({
      codigoPedido: CODIGO,
      tipo: 'factura',
      folio: 4521,
      fechaEmision: '2026-10-29',
      estado: 'emitido',
    });
    const [clave, contenido, tipo, privado] = almacen.guardar.mock.calls[0];
    expect(clave).toMatch(/^facturas\/40\/[0-9a-f-]{36}\.pdf$/);
    expect(contenido).toBe(PDF.buffer);
    expect(tipo).toBe('application/pdf');
    expect(privado).toBe(true);
    expect(db.documentoTributario.create.mock.calls[0][0].data).toEqual({
      pedidoId: 40,
      tipo: 'factura',
      folio: 4521,
      fechaEmision: new Date('2026-10-29T00:00:00Z'),
      estado: 'emitido',
      montoNeto: 10000,
      montoIva: 1900,
      montoTotal: 11900,
      ubicacionArchivo: clave,
      rutReceptor: '76123456-0',
      razonSocialReceptor: 'Peluquería Bella Ltda.',
      giroReceptor: 'Servicios de peluquería',
      direccionReceptor: 'Calle Falsa 123',
      comunaReceptor: 'Concepción',
    });
    expect(almacen.eliminar).not.toHaveBeenCalled();
  });

  it('E9-H3 · sin fecha de emisión usa la de hoy en la zona horaria de la tienda', async () => {
    const respuesta = await registrar({ folio: 4521 });

    expect(respuesta.fechaEmision).toBe(hoyEnLaTienda());
  });

  it.each([
    'pagado',
    'en_preparacion',
    'despachado',
    'entregado',
    'listo_para_retiro',
    'retirado',
  ])(
    'E9-H3 · un pedido en «%s» ya está pagado y admite su factura',
    async (estado) => {
      pedidoPrevio({ estadoActual: estado });
      db.$queryRaw.mockResolvedValue([
        {
          id: 40,
          estado,
          tipoDocumento: 'factura',
          datosFacturacionId: 3,
          montoNeto: 10000,
          montoIva: 1900,
          montoTotal: 11900,
        },
      ]);

      await expect(registrar()).resolves.toMatchObject({ folio: 4521 });
    },
  );

  it('E9-H3 · folio repetido: 409 y no sube ningún archivo', async () => {
    db.documentoTributario.findFirst.mockImplementation(
      ({ where }: { where: { folio?: number } }) =>
        Promise.resolve(where.folio === undefined ? null : { id: 9 }),
    );

    await expect(registrar()).rejects.toThrow(
      new ConflictException(folioRepetido(4521)),
    );
    expect(almacen.guardar).not.toHaveBeenCalled();
    expect(db.documentoTributario.create).not.toHaveBeenCalled();
  });

  it('E9-H3 · folio repetido por un registro simultáneo (restricción UNIQUE): 409 y borra el PDF que subió', async () => {
    db.documentoTributario.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(registrar()).rejects.toThrow(
      new ConflictException(folioRepetido(4521)),
    );
    expect(almacen.eliminar).toHaveBeenCalledWith(
      almacen.guardar.mock.calls[0][0],
    );
  });

  it.each([
    [{ tipoDocumentoSolicitado: 'boleta' }, NO_PIDIO_FACTURA],
    [{ estadoActual: 'pendiente_pago' }, PEDIDO_NO_PAGADO],
    [{ estadoActual: 'cancelado' }, PEDIDO_NO_PAGADO],
    [{ documentos: [{ id: 5 }] }, YA_TIENE_FACTURA],
    [{ datosFacturacionId: null }, SIN_DATOS_FACTURACION],
  ])(
    'E9-H3 · pedido que no admite la factura (%j): 409 y no sube ningún archivo',
    async (cambios, mensaje) => {
      pedidoPrevio(cambios);

      await expect(registrar()).rejects.toThrow(new ConflictException(mensaje));
      expect(almacen.guardar).not.toHaveBeenCalled();
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );

  it('E9-H3 · si otro registro ganó mientras se subía el PDF, la revisión con el pedido bloqueado responde 409 y borra el PDF', async () => {
    db.documentoTributario.findFirst.mockImplementation(
      ({ where }: { where: { folio?: number } }) =>
        Promise.resolve(
          where.folio === undefined && db.$transaction.mock.calls.length > 0
            ? { id: 5 }
            : null,
        ),
    );

    await expect(registrar()).rejects.toThrow(
      new ConflictException(YA_TIENE_FACTURA),
    );
    expect(almacen.eliminar).toHaveBeenCalledTimes(1);
    expect(db.documentoTributario.create).not.toHaveBeenCalled();
  });

  it('pedido inexistente: 404 y no sube ningún archivo', async () => {
    db.pedido.findUnique.mockResolvedValue(null);

    await expect(registrar()).rejects.toThrow(
      new NotFoundException('El pedido no existe.'),
    );
    expect(almacen.guardar).not.toHaveBeenCalled();
  });

  it('E9-H3 · sin PDF, con un archivo que no es PDF, demasiado grande o con fecha futura: 400', async () => {
    await expect(
      servicio.registrar(CODIGO, { folio: 1 }, undefined),
    ).rejects.toThrow(new BadRequestException(SIN_ARCHIVO));
    await expect(
      registrar(
        { folio: 1 },
        { buffer: Buffer.from([0xff, 0xd8, 0xff]), size: 3 },
      ),
    ).rejects.toThrow(new BadRequestException(NO_ES_PDF));
    await expect(
      registrar(
        { folio: 1 },
        { buffer: PDF.buffer, size: 5 * 1024 * 1024 + 1 },
      ),
    ).rejects.toThrow(new BadRequestException(FACTURA_MUY_GRANDE));
    await expect(
      registrar({ folio: 1, fechaEmision: '2999-01-01' }),
    ).rejects.toThrow(new BadRequestException(FECHA_FUTURA));
    expect(db.pedido.findUnique).not.toHaveBeenCalled();
    expect(almacen.guardar).not.toHaveBeenCalled();
  });

  it('RNF-12 · si el almacén falla, 503 y no toca la base', async () => {
    almacen.guardar.mockRejectedValue(new Error('R2 no responde'));

    await expect(registrar()).rejects.toThrow(
      new ServiceUnavailableException(
        'No se pudo guardar la factura. Intenta de nuevo en unos minutos.',
      ),
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('almacén sin configurar: 503 con su mensaje y no toca la base', async () => {
    almacen.guardar.mockRejectedValue(
      new ServiceUnavailableException(
        'El almacenamiento de archivos no está configurado.',
      ),
    );

    await expect(registrar()).rejects.toThrow(
      'El almacenamiento de archivos no está configurado.',
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('RNF-12 · si la base falla, borra el PDF que subió y no oculta el error; si borrarlo también falla, igual responde el error original', async () => {
    db.documentoTributario.create.mockRejectedValue(new Error('falló la base'));
    almacen.eliminar.mockRejectedValue(new Error('R2 no responde'));

    await expect(registrar()).rejects.toThrow('falló la base');
    expect(almacen.eliminar).toHaveBeenCalledTimes(1);
  });

  it('pedido que desaparece antes de bloquearlo: 404 y borra el PDF', async () => {
    db.$queryRaw.mockResolvedValue([]);

    await expect(registrar()).rejects.toThrow(
      new NotFoundException('El pedido no existe.'),
    );
    expect(almacen.eliminar).toHaveBeenCalledTimes(1);
  });
});
