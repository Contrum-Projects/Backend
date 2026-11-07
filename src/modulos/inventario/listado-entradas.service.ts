import { BadRequestException, Injectable } from '@nestjs/common';
import { aFechaSinHora } from '../../common/dominio/fechas.js';
import { errorDeCampo } from '../../common/errores/error-de-campo.js';
import { POR_PAGINA } from '../../common/validacion/paginacion.js';
import { escaparComodines } from '../../common/validacion/texto-busqueda.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  EntradaListadoDto,
  ListadoEntradasDto,
} from './dto/entrada-respuesta.dto.js';
import type { ListarEntradasDto } from './dto/listar-entradas.dto.js';
import { totalesEntrada } from './totales-entrada.js';

/**
 * Entradas de inventario del panel (E11-H2 criterio 1, SCRUM-150), de la recepción más reciente
 * a la más antigua. Los totales se suman aquí, no en la pantalla.
 */
@Injectable()
export class ListadoEntradasService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(filtros: ListarEntradasDto): Promise<ListadoEntradasDto> {
    const { bodegaId, buscar, desde, hasta } = filtros;
    if (desde && hasta && hasta < desde) {
      throw errorDeCampo(
        BadRequestException,
        'La fecha hasta no puede ser anterior a la fecha desde.',
        'hasta',
      );
    }
    const pagina = filtros.pagina ?? 1;
    const limite = filtros.limite ?? POR_PAGINA;
    const texto = buscar
      ? { contains: escaparComodines(buscar), mode: 'insensitive' as const }
      : undefined;
    const where: Prisma.EntradaInventarioWhereInput = {
      fechaRecepcion:
        desde || hasta
          ? {
              gte: desde ? aFechaSinHora(desde) : undefined,
              lte: hasta ? aFechaSinHora(hasta) : undefined,
            }
          : undefined,
      OR: texto
        ? [
            { proveedor: { razonSocial: texto } },
            { numeroDocumentoProveedor: texto },
          ]
        : undefined,
      // La ubicación de destino es una para toda la entrada y queda en sus movimientos
      movimientos: bodegaId
        ? { some: { ubicacionDestino: { bodegaId } } }
        : undefined,
    };

    const [filas, total] = await this.prisma.$transaction([
      this.prisma.entradaInventario.findMany({
        where,
        select: {
          id: true,
          fechaRecepcion: true,
          tipoDocumentoProveedor: true,
          numeroDocumentoProveedor: true,
          proveedor: { select: { id: true, razonSocial: true } },
          usuario: { select: { nombre: true, apellido: true } },
          detalles: {
            select: { cantidadRecibida: true, costoUnitarioNeto: true },
          },
          movimientos: {
            take: 1,
            orderBy: { id: 'asc' },
            select: {
              ubicacionDestino: {
                select: {
                  id: true,
                  codigo: true,
                  bodega: { select: { nombre: true } },
                },
              },
            },
          },
        },
        orderBy: [{ fechaRecepcion: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * limite,
        take: limite,
      }),
      this.prisma.entradaInventario.count({ where }),
    ]);

    const items = filas.flatMap((fila): EntradaListadoDto[] => {
      const destino = fila.movimientos[0]?.ubicacionDestino;
      if (!destino) {
        return [];
      }
      return [
        {
          id: fila.id,
          fechaRecepcion: fila.fechaRecepcion.toISOString().slice(0, 10),
          tipoDocumento:
            fila.tipoDocumentoProveedor as EntradaListadoDto['tipoDocumento'],
          numeroDocumento: fila.numeroDocumentoProveedor,
          proveedor: fila.proveedor,
          ubicacion: {
            id: destino.id,
            codigo: destino.codigo,
            bodega: destino.bodega.nombre,
          },
          cantidadFormatos: fila.detalles.length,
          ...totalesEntrada(
            fila.detalles.map((detalle) => ({
              cantidad: detalle.cantidadRecibida,
              costoUnitarioNeto: detalle.costoUnitarioNeto,
            })),
          ),
          registradoPor: {
            nombre: `${fila.usuario.nombre} ${fila.usuario.apellido}`,
          },
        },
      ];
    });
    return { items, total, pagina, limite };
  }
}
