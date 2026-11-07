import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { hoyEnLaTienda } from '../../common/dominio/fechas.js';
import {
  TIPOS_DOCUMENTO_PROVEEDOR,
  TIPOS_MOVIMIENTO,
  type Valor,
} from '../../common/dominio/valores.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { type UbicacionResumen, ubicacionDe } from './comprobaciones.js';
import type { CrearEntradaDto } from './dto/crear-entrada.dto.js';
import { sumarExistencia } from './existencias.js';
import { errorDeCampo } from '../../common/errores/error-de-campo.js';
import { subtotalNeto, totalesEntrada } from './totales-entrada.js';

type Tx = Prisma.TransactionClient;
type TipoDocumentoProveedor = Valor<typeof TIPOS_DOCUMENTO_PROVEEDOR>;

/** Un formato recibido y el movimiento de entrada que lo respalda. */
export interface DetalleEntradaRegistrado {
  formatoId: number;
  cantidad: number;
  costoUnitarioNeto: number;
  /** Cantidad por costo unitario neto (SCRUM-150). */
  subtotalNeto: number;
  movimientoId: number;
}

/** La entrada tal como la ve el panel después de registrarla. */
export interface EntradaRegistrada {
  id: number;
  proveedor: { id: number; rut: string; razonSocial: string };
  fechaRecepcion: string;
  tipoDocumento: TipoDocumentoProveedor;
  numeroDocumento: string;
  observacion: string | null;
  ubicacion: UbicacionResumen;
  detalles: DetalleEntradaRegistrado[];
  /** Unidades recibidas en total (SCRUM-150). */
  unidades: number;
  /** Suma de los subtotales netos (SCRUM-150). */
  costoNetoTotal: number;
}

/**
 * Entradas de inventario recibidas de un proveedor (E11-H2, RF-11.02 a RF-11.04). La entrada, su
 * detalle, el stock y un movimiento por formato se escriben en una misma transacción (RNF-12):
 * el stock nunca cambia sin el movimiento que lo explica.
 */
@Injectable()
export class EntradasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra la entrada y suma lo recibido al stock de la ubicación de destino. El proveedor y la
   * ubicación deben estar activos; la fecha no puede ser posterior a hoy y el documento del
   * proveedor no puede repetirse (409).
   */
  async registrar(
    dto: CrearEntradaDto,
    codigoPublicoUsuario: string,
  ): Promise<EntradaRegistrada> {
    if (dto.fechaRecepcion > hoyEnLaTienda()) {
      throw errorDeCampo(
        BadRequestException,
        'La fecha de recepción no puede ser posterior a hoy.',
        'fechaRecepcion',
      );
    }
    // Las existencias se tocan en orden de formato: dos entradas simultáneas no se bloquean
    // entre sí en orden cruzado
    const detalles = [...dto.detalles].sort(
      (a, b) => a.formatoId - b.formatoId,
    );
    const numeroDocumento = normalizarNumeroDocumento(dto.numeroDocumento);

    return this.prisma.$transaction(async (tx) => {
      const usuario = await tx.usuario.findUnique({
        where: { codigoPublico: codigoPublicoUsuario },
        select: { id: true },
      });
      if (!usuario) {
        throw new UnauthorizedException('Debes iniciar sesión.');
      }
      const proveedor = await this.proveedorActivo(tx, dto.proveedorId);
      const ubicacion = await ubicacionDe(tx, dto.ubicacionId, {
        activa: true,
      });
      await this.comprobarFormatos(tx, dto.detalles);

      const entrada = await this.crearEntrada(
        tx,
        dto,
        numeroDocumento,
        usuario.id,
      );
      for (const detalle of detalles) {
        const sumada = await sumarExistencia(
          tx,
          { formatoId: detalle.formatoId, ubicacionId: dto.ubicacionId },
          detalle.cantidad,
        );
        if (!sumada) {
          // El campo es la línea tal como llegó (SCRUM-150), no la del orden por formato
          throw errorDeCampo(
            BadRequestException,
            `El stock del formato ${detalle.formatoId} en esa ubicación superaría el máximo permitido.`,
            ...lineasDe(dto.detalles, [detalle.formatoId], 'cantidad'),
          );
        }
      }
      const movimientos = await tx.movimientoInventario.createManyAndReturn({
        data: detalles.map((detalle) => ({
          formatoId: detalle.formatoId,
          entradaId: entrada.id,
          ubicacionDestinoId: dto.ubicacionId,
          usuarioId: usuario.id,
          tipo: TIPOS_MOVIMIENTO.ENTRADA,
          cantidad: detalle.cantidad,
        })),
        select: { id: true, formatoId: true },
      });
      const movimientoDe = new Map(
        movimientos.map((movimiento) => [movimiento.formatoId, movimiento.id]),
      );

      return {
        id: entrada.id,
        proveedor,
        fechaRecepcion: dto.fechaRecepcion,
        tipoDocumento: dto.tipoDocumento as TipoDocumentoProveedor,
        numeroDocumento,
        observacion: dto.observacion ?? null,
        ubicacion,
        detalles: detalles.map((detalle) => ({
          formatoId: detalle.formatoId,
          cantidad: detalle.cantidad,
          costoUnitarioNeto: detalle.costoUnitarioNeto,
          subtotalNeto: subtotalNeto(
            detalle.cantidad,
            detalle.costoUnitarioNeto,
          ).toNumber(),
          movimientoId: movimientoDe.get(detalle.formatoId)!,
        })),
        ...totalesEntrada(detalles),
      };
    });
  }

  private async proveedorActivo(tx: Tx, id: number) {
    const proveedor = await tx.proveedor.findUnique({
      where: { id },
      select: { id: true, rut: true, razonSocial: true, activo: true },
    });
    if (!proveedor) {
      throw errorDeCampo(
        BadRequestException,
        'El proveedor no existe.',
        'proveedorId',
      );
    }
    if (!proveedor.activo) {
      throw errorDeCampo(
        BadRequestException,
        'El proveedor está desactivado: no se le pueden registrar entradas.',
        'proveedorId',
      );
    }
    return {
      id: proveedor.id,
      rut: proveedor.rut,
      razonSocial: proveedor.razonSocial,
    };
  }

  /** Todos los formatos existen; si falta alguno, dice cuáles y en qué líneas están (SCRUM-150). */
  private async comprobarFormatos(tx: Tx, lineas: CrearEntradaDto['detalles']) {
    const ids = lineas.map((linea) => linea.formatoId);
    const existentes = await tx.formatoProducto.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const encontrados = new Set(existentes.map((formato) => formato.id));
    // En orden de formato, como antes de que llegaran las líneas sin ordenar
    const faltantes = [
      ...new Set(ids.filter((id) => !encontrados.has(id))),
    ].sort((a, b) => a - b);
    if (faltantes.length > 0) {
      throw errorDeCampo(
        BadRequestException,
        faltantes.length === 1
          ? `El formato ${faltantes[0]} no existe.`
          : `Los formatos ${faltantes.join(', ')} no existen.`,
        ...lineasDe(lineas, faltantes, 'formatoId'),
      );
    }
  }

  /**
   * Crea la entrada con su detalle. El documento repetido lo decide la restricción UNIQUE de
   * (proveedor, tipo, número), no una consulta previa: dos registros simultáneos del mismo
   * documento no pueden crearse los dos.
   */
  private async crearEntrada(
    tx: Tx,
    dto: CrearEntradaDto,
    numeroDocumento: string,
    usuarioId: number,
  ) {
    try {
      return await tx.entradaInventario.create({
        data: {
          proveedorId: dto.proveedorId,
          usuarioId,
          fechaRecepcion: new Date(`${dto.fechaRecepcion}T00:00:00Z`),
          tipoDocumentoProveedor: dto.tipoDocumento,
          numeroDocumentoProveedor: numeroDocumento,
          observacion: dto.observacion ?? null,
          detalles: {
            create: dto.detalles.map((detalle) => ({
              formatoId: detalle.formatoId,
              cantidadRecibida: detalle.cantidad,
              costoUnitarioNeto: detalle.costoUnitarioNeto,
            })),
          },
        },
        select: { id: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw errorDeCampo(
          ConflictException,
          'Ya hay una entrada registrada con ese documento del proveedor.',
          'numeroDocumento',
        );
      }
      throw error;
    }
  }
}

/**
 * Número de documento como se guarda: sin espacios y en mayúsculas, para que la misma factura
 * escrita de otra forma choque con la restricción UNIQUE.
 */
export const normalizarNumeroDocumento = (numero: string) =>
  numero.replace(/\s+/g, '').toUpperCase();

/**
 * Las rutas `detalles.<n>.<propiedad>` de las líneas con esos formatos, en el orden en que
 * llegaron (SCRUM-150): así el panel marca la línea exacta. Siempre hay al menos una.
 */
const lineasDe = (
  lineas: CrearEntradaDto['detalles'],
  formatoIds: number[],
  propiedad: 'formatoId' | 'cantidad',
): [string, ...string[]] => {
  const rutas = lineas.flatMap((linea, indice) =>
    formatoIds.includes(linea.formatoId)
      ? [`detalles.${indice}.${propiedad}`]
      : [],
  );
  return rutas.length > 0 ? (rutas as [string, ...string[]]) : ['detalles'];
};
