import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  TIPOS_DOCUMENTO_PROVEEDOR,
  TIPOS_MOVIMIENTO,
  type Valor,
} from '../../common/dominio/valores.js';
import { MAXIMO_INT4 } from '../../common/validacion/enteros.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CrearEntradaDto } from './dto/crear-entrada.dto.js';

type Tx = Prisma.TransactionClient;
type TipoDocumentoProveedor = Valor<typeof TIPOS_DOCUMENTO_PROVEEDOR>;

/** Zona horaria de la tienda: «hoy» para la fecha de recepción. */
const ZONA_HORARIA_TIENDA = 'America/Santiago';

/** Un formato recibido y el movimiento de entrada que lo respalda. */
export interface DetalleEntradaRegistrado {
  formatoId: number;
  cantidad: number;
  costoUnitarioNeto: number;
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
  ubicacion: { id: number; codigo: string; bodega: string };
  detalles: DetalleEntradaRegistrado[];
}

/** Fecha de hoy (AAAA-MM-DD) en la zona horaria de la tienda. */
export const hoyEnLaTienda = (ahora = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA_TIENDA }).format(
    ahora,
  );

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
      throw new BadRequestException(
        'La fecha de recepción no puede ser posterior a hoy.',
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
      const ubicacion = await this.ubicacionActiva(tx, dto.ubicacionId);
      await this.comprobarFormatos(
        tx,
        detalles.map((detalle) => detalle.formatoId),
      );

      const entrada = await this.crearEntrada(
        tx,
        dto,
        numeroDocumento,
        usuario.id,
      );
      for (const detalle of detalles) {
        const sumada = await sumarExistencia(
          tx,
          detalle.formatoId,
          dto.ubicacionId,
          detalle.cantidad,
        );
        if (!sumada) {
          throw new BadRequestException(
            `El stock del formato ${detalle.formatoId} en esa ubicación superaría el máximo permitido.`,
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
          movimientoId: movimientoDe.get(detalle.formatoId)!,
        })),
      };
    });
  }

  private async proveedorActivo(tx: Tx, id: number) {
    const proveedor = await tx.proveedor.findUnique({
      where: { id },
      select: { id: true, rut: true, razonSocial: true, activo: true },
    });
    if (!proveedor) {
      throw new BadRequestException('El proveedor no existe.');
    }
    if (!proveedor.activo) {
      throw new BadRequestException(
        'El proveedor está desactivado: no se le pueden registrar entradas.',
      );
    }
    return {
      id: proveedor.id,
      rut: proveedor.rut,
      razonSocial: proveedor.razonSocial,
    };
  }

  private async ubicacionActiva(tx: Tx, id: number) {
    const ubicacion = await tx.ubicacion.findUnique({
      where: { id },
      select: {
        id: true,
        codigo: true,
        activa: true,
        bodega: { select: { nombre: true, activa: true } },
      },
    });
    if (!ubicacion) {
      throw new BadRequestException('La ubicación no existe.');
    }
    if (!ubicacion.activa || !ubicacion.bodega.activa) {
      throw new BadRequestException(
        'La ubicación o su bodega está desactivada: elige otra ubicación.',
      );
    }
    return {
      id: ubicacion.id,
      codigo: ubicacion.codigo,
      bodega: ubicacion.bodega.nombre,
    };
  }

  /** Todos los formatos existen; si falta alguno, dice cuáles. */
  private async comprobarFormatos(tx: Tx, ids: number[]) {
    const existentes = await tx.formatoProducto.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const encontrados = new Set(existentes.map((formato) => formato.id));
    const faltantes = ids.filter((id) => !encontrados.has(id));
    if (faltantes.length > 0) {
      throw new BadRequestException(
        faltantes.length === 1
          ? `El formato ${faltantes[0]} no existe.`
          : `Los formatos ${faltantes.join(', ')} no existen.`,
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
        throw new ConflictException(
          'Ya hay una entrada registrada con ese documento del proveedor.',
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
 * Suma unidades a la existencia del formato en la ubicación, o la crea, en una sola sentencia
 * atómica: dos entradas simultáneas del mismo formato suman las dos (RNF-13). Devuelve `false`
 * si la suma pasaría el máximo de la columna (int4); entonces no cambia nada.
 */
const sumarExistencia = async (
  tx: Tx,
  formatoId: number,
  ubicacionId: number,
  cantidad: number,
): Promise<boolean> => {
  const filas = await tx.$executeRaw`
    INSERT INTO existencia (id_formato, id_ubicacion, cantidad, fecha_actualizacion)
    VALUES (${formatoId}, ${ubicacionId}, ${cantidad}, now())
    ON CONFLICT (id_formato, id_ubicacion) DO UPDATE
    SET cantidad = existencia.cantidad + EXCLUDED.cantidad,
        fecha_actualizacion = now()
    WHERE existencia.cantidad::bigint + EXCLUDED.cantidad <= ${MAXIMO_INT4}`;
  return filas === 1;
};
