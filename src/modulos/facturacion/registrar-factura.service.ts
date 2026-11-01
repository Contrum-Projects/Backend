import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AlmacenArchivos } from '../../almacen/almacen-archivos.js';
import { aFechaSinHora, hoyEnLaTienda } from '../../common/dominio/fechas.js';
import {
  ESTADOS_DOCUMENTO,
  ESTADOS_PEDIDO,
  TIPOS_DOCUMENTO,
} from '../../common/dominio/valores.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PEDIDO_NO_EXISTE } from '../pedidos/codigo-pedido.pipe.js';
import type { RegistrarFacturaDto } from './dto/registrar-factura.dto.js';
import { esPdf, TAMANO_MAXIMO_FACTURA_BYTES } from './tipo-archivo-factura.js';

export const SIN_ARCHIVO =
  'Adjunta el PDF de la factura en el campo «archivo».';
export const NO_ES_PDF = 'La factura debe ser un archivo PDF.';
export const FACTURA_MUY_GRANDE = 'La factura no puede superar los 5 MB.';
export const FECHA_FUTURA = 'La fecha de emisión no puede ser futura.';
export const NO_PIDIO_FACTURA = 'El pedido no pidió factura.';
export const PEDIDO_NO_PAGADO =
  'Solo se puede registrar la factura de un pedido pagado.';
export const YA_TIENE_FACTURA = 'El pedido ya tiene una factura registrada.';
export const SIN_DATOS_FACTURACION =
  'El pedido no tiene datos de facturación para copiar al documento.';
export const folioRepetido = (folio: number) =>
  `Ya existe una factura con el folio ${folio}.`;

/** Lo que el servicio necesita del archivo que recibe el controlador (multer, en memoria). */
export interface ArchivoSubido {
  buffer: Buffer;
  size: number;
}

/** Factura registrada tal como la ve el panel. El archivo no se expone: lo entrega E9-H4. */
export interface FacturaRegistrada {
  codigoPedido: string;
  tipo: string;
  folio: number;
  fechaEmision: string;
  estado: string;
}

interface PedidoParaFactura {
  id: number;
  estado: string;
  tipoDocumento: string;
  datosFacturacionId: number | null;
  montoNeto: number;
  montoIva: number;
  montoTotal: number;
}

/** Estados en que el pedido ya se pagó (todos menos pendiente de pago y cancelado). */
const ESTADOS_SIN_PAGO: readonly string[] = [
  ESTADOS_PEDIDO.PENDIENTE_PAGO,
  ESTADOS_PEDIDO.CANCELADO,
];

/**
 * Registro de la factura emitida en el SII (E9-H3, RF-09.04 y RF-09.05). El personal sube el PDF
 * con el folio; el documento guarda una copia de los datos del receptor y de los montos del
 * pedido, para que no cambien aunque después se edite o desactive el dato de facturación. El PDF
 * se sube antes de la transacción (no se espera a un servicio externo con la fila bloqueada) y se
 * borra si la base no lo llega a registrar. La fila del pedido se bloquea, así dos registros
 * simultáneos no dejan dos facturas.
 */
@Injectable()
export class RegistrarFacturaService {
  private readonly logger = new Logger(RegistrarFacturaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almacen: AlmacenArchivos,
  ) {}

  async registrar(
    codigoPedido: string,
    dto: RegistrarFacturaDto,
    archivo: ArchivoSubido | undefined,
  ): Promise<FacturaRegistrada> {
    if (!archivo) throw new BadRequestException(SIN_ARCHIVO);
    if (archivo.size > TAMANO_MAXIMO_FACTURA_BYTES) {
      throw new BadRequestException(FACTURA_MUY_GRANDE);
    }
    if (!esPdf(archivo.buffer)) throw new BadRequestException(NO_ES_PDF);
    const hoy = hoyEnLaTienda();
    const fechaEmision = dto.fechaEmision ?? hoy;
    if (fechaEmision > hoy) throw new BadRequestException(FECHA_FUTURA);

    // Revisión previa para no subir un archivo que no se va a poder registrar
    const previo = await this.prisma.pedido.findUnique({
      where: { codigoPublico: codigoPedido },
      select: {
        id: true,
        estadoActual: true,
        tipoDocumentoSolicitado: true,
        datosFacturacionId: true,
        montoNeto: true,
        montoIva: true,
        montoTotal: true,
        documentos: {
          where: { tipo: TIPOS_DOCUMENTO.FACTURA, anuladorId: null },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!previo) throw new NotFoundException(PEDIDO_NO_EXISTE);
    exigirRegistrable(
      {
        id: previo.id,
        estado: previo.estadoActual,
        tipoDocumento: previo.tipoDocumentoSolicitado,
        datosFacturacionId: previo.datosFacturacionId,
        montoNeto: previo.montoNeto,
        montoIva: previo.montoIva,
        montoTotal: previo.montoTotal,
      },
      previo.documentos.length > 0,
    );
    await exigirFolioLibre(this.prisma, dto.folio);

    const clave = `facturas/${previo.id}/${randomUUID()}.pdf`;
    await this.guardarArchivo(clave, archivo.buffer);
    try {
      const documento = await this.prisma.$transaction(async (tx) => {
        const [pedido] = await tx.$queryRaw<PedidoParaFactura[]>`
          SELECT id_pedido AS id,
                 estado_actual AS estado,
                 tipo_documento_solicitado AS "tipoDocumento",
                 id_datos_facturacion AS "datosFacturacionId",
                 monto_neto AS "montoNeto",
                 monto_iva AS "montoIva",
                 monto_total AS "montoTotal"
          FROM pedido
          WHERE codigo_publico = ${codigoPedido}
          FOR NO KEY UPDATE`;
        if (!pedido) throw new NotFoundException(PEDIDO_NO_EXISTE);
        const yaTiene = await tx.documentoTributario.findFirst({
          where: {
            pedidoId: pedido.id,
            tipo: TIPOS_DOCUMENTO.FACTURA,
            anuladorId: null,
          },
          select: { id: true },
        });
        exigirRegistrable(pedido, yaTiene !== null);
        await exigirFolioLibre(tx, dto.folio);

        const receptor = await tx.datosFacturacion.findUniqueOrThrow({
          where: { id: pedido.datosFacturacionId as number },
          select: {
            rut: true,
            razonSocial: true,
            giro: true,
            direccion: true,
            comuna: { select: { nombre: true } },
          },
        });
        return tx.documentoTributario.create({
          data: {
            pedidoId: pedido.id,
            tipo: TIPOS_DOCUMENTO.FACTURA,
            folio: dto.folio,
            fechaEmision: aFechaSinHora(fechaEmision),
            estado: ESTADOS_DOCUMENTO.EMITIDO,
            montoNeto: pedido.montoNeto,
            montoIva: pedido.montoIva,
            montoTotal: pedido.montoTotal,
            ubicacionArchivo: clave,
            rutReceptor: receptor.rut,
            razonSocialReceptor: receptor.razonSocial,
            giroReceptor: receptor.giro,
            direccionReceptor: receptor.direccion,
            comunaReceptor: receptor.comuna.nombre,
          },
          select: { folio: true, estado: true },
        });
      });
      return {
        codigoPedido,
        tipo: TIPOS_DOCUMENTO.FACTURA,
        folio: documento.folio as number,
        fechaEmision,
        estado: documento.estado,
      };
    } catch (error) {
      await this.borrarArchivo(clave);
      // Dos registros del mismo folio a la vez: la restricción UNIQUE deja pasar uno solo
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(folioRepetido(dto.folio));
      }
      throw error;
    }
  }

  private async guardarArchivo(clave: string, contenido: Buffer) {
    try {
      // Privado: una factura no se entrega con URL pública sino por la API (E9-H4)
      await this.almacen.guardar(clave, contenido, 'application/pdf', true);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(
        `No se pudo guardar ${clave} en el almacén: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'No se pudo guardar la factura. Intenta de nuevo en unos minutos.',
      );
    }
  }

  /** Borra el PDF que no llegó a registrarse; si tampoco se puede, queda en el registro. */
  private async borrarArchivo(clave: string) {
    try {
      await this.almacen.eliminar(clave);
    } catch (error) {
      this.logger.warn(
        `No se pudo borrar ${clave} del almacén: ${(error as Error).message}`,
      );
    }
  }
}

/** Reglas del pedido para registrar su factura. Se revisan antes y dentro de la transacción. */
const exigirRegistrable = (
  pedido: PedidoParaFactura,
  yaTieneFactura: boolean,
) => {
  if (pedido.tipoDocumento !== TIPOS_DOCUMENTO.FACTURA) {
    throw new ConflictException(NO_PIDIO_FACTURA);
  }
  if (ESTADOS_SIN_PAGO.includes(pedido.estado)) {
    throw new ConflictException(PEDIDO_NO_PAGADO);
  }
  if (yaTieneFactura) throw new ConflictException(YA_TIENE_FACTURA);
  if (pedido.datosFacturacionId === null) {
    throw new ConflictException(SIN_DATOS_FACTURACION);
  }
};

/** El folio es único entre las facturas (RF-09.04). */
const exigirFolioLibre = async (
  cliente: Pick<PrismaService, 'documentoTributario'>,
  folio: number,
) => {
  const existente = await cliente.documentoTributario.findFirst({
    where: { tipo: TIPOS_DOCUMENTO.FACTURA, folio },
    select: { id: true },
  });
  if (existente) throw new ConflictException(folioRepetido(folio));
};
