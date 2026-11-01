import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { AlmacenArchivos } from '../../almacen/almacen-archivos.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  DescargarDocumentoService,
  DOCUMENTO_NO_DISPONIBLE,
  DOCUMENTO_PENDIENTE,
} from './descargar-documento.service.js';

const CUENTA = '3f0c2a52-0b9e-4c55-9d0e-6a3a4f6d1b2c';
const CODIGO = 'AB12CD34EF56';
const PDF = Buffer.from('%PDF-1.7\n...');

describe('DescargarDocumentoService', () => {
  let db: { pedido: { findFirst: ReturnType<typeof vi.fn> } };
  let almacen: { obtener: ReturnType<typeof vi.fn> };
  let servicio: DescargarDocumentoService;

  beforeEach(() => {
    db = {
      pedido: {
        findFirst: vi.fn().mockResolvedValue({
          documentos: [
            { folio: 4521, ubicacionArchivo: 'facturas/40/abc.pdf' },
          ],
        }),
      },
    };
    almacen = { obtener: vi.fn().mockResolvedValue(PDF) };
    servicio = new DescargarDocumentoService(
      db as unknown as PrismaService,
      almacen as unknown as AlmacenArchivos,
    );
  });

  it('E9-H4 · documento disponible: entrega el PDF con el nombre de la factura, buscando solo en la cuenta del token', async () => {
    const archivo = await servicio.descargar(CUENTA, CODIGO);

    expect(archivo).toEqual({ contenido: PDF, nombre: 'factura-4521.pdf' });
    expect(almacen.obtener).toHaveBeenCalledWith('facturas/40/abc.pdf');
    const consulta = db.pedido.findFirst.mock.calls[0][0];
    expect(consulta.where).toEqual({
      codigoPublico: CODIGO,
      usuario: { codigoPublico: CUENTA },
    });
    expect(consulta.select.documentos.where).toEqual({
      tipo: 'factura',
      anuladorId: null,
      ubicacionArchivo: { not: null },
    });
  });

  it('E9-H4 · pedido de otra cuenta o inexistente: 404 y no lee el almacén', async () => {
    db.pedido.findFirst.mockResolvedValue(null);

    await expect(servicio.descargar(CUENTA, CODIGO)).rejects.toThrow(
      new NotFoundException('El pedido no existe.'),
    );
    expect(almacen.obtener).not.toHaveBeenCalled();
  });

  it('E9-H4 · documento pendiente: 404 sin archivo y no lee el almacén', async () => {
    db.pedido.findFirst.mockResolvedValue({ documentos: [] });

    await expect(servicio.descargar(CUENTA, CODIGO)).rejects.toThrow(
      new NotFoundException(DOCUMENTO_PENDIENTE),
    );
    expect(almacen.obtener).not.toHaveBeenCalled();
  });

  it('si el almacén no responde: 503 sin detalles del error', async () => {
    almacen.obtener.mockRejectedValue(new Error('NoSuchKey: facturas/40/abc'));

    await expect(servicio.descargar(CUENTA, CODIGO)).rejects.toThrow(
      new ServiceUnavailableException(DOCUMENTO_NO_DISPONIBLE),
    );
  });

  it('almacén sin configurar: 503 con su mensaje', async () => {
    almacen.obtener.mockRejectedValue(
      new ServiceUnavailableException(
        'El almacenamiento de archivos no está configurado.',
      ),
    );

    await expect(servicio.descargar(CUENTA, CODIGO)).rejects.toThrow(
      'El almacenamiento de archivos no está configurado.',
    );
  });
  describe('descargarComoPersonal', () => {
    it('E9-H4 · el personal descarga la factura de cualquier pedido: busca solo por el código, sin filtrar por cuenta', async () => {
      const archivo = await servicio.descargarComoPersonal(CODIGO);

      expect(archivo).toEqual({ contenido: PDF, nombre: 'factura-4521.pdf' });
      expect(db.pedido.findFirst.mock.calls[0][0].where).toEqual({
        codigoPublico: CODIGO,
      });
      expect(almacen.obtener).toHaveBeenCalledWith('facturas/40/abc.pdf');
    });

    it('E9-H4 · pedido inexistente o factura pendiente: 404 y no lee el almacén', async () => {
      db.pedido.findFirst.mockResolvedValueOnce(null);
      await expect(servicio.descargarComoPersonal(CODIGO)).rejects.toThrow(
        new NotFoundException('El pedido no existe.'),
      );

      db.pedido.findFirst.mockResolvedValueOnce({ documentos: [] });
      await expect(servicio.descargarComoPersonal(CODIGO)).rejects.toThrow(
        new NotFoundException(DOCUMENTO_PENDIENTE),
      );
      expect(almacen.obtener).not.toHaveBeenCalled();
    });
  });
});
