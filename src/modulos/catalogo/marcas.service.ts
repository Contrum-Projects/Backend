import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TIPOS_DESTINO_PORTADA } from '../../common/dominio/valores.js';
import { CANDADOS, tomarCandado } from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CacheCatalogo, CLAVES_CACHE } from './cache-catalogo.js';
import type { CrearMarcaDto } from './dto/crear-marca.dto.js';
import { errorDeCampo } from '../../common/errores/error-de-campo.js';
import {
  contarEnPortada,
  exigirSinUsos,
  traducirUsoSimultaneo,
} from './usos-catalogo.js';

@Injectable()
export class MarcasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheCatalogo,
  ) {}

  /**
   * Crea una marca (E3-H4, RF-03.05). Una marca ya existe si hay otra con el mismo
   * nombre sin importar mayúsculas o minúsculas («kerastase» = «Kerastase»; las tildes
   * sí distinguen).
   * La restricción UNIQUE de la base solo distingue mayúsculas, así que la
   * comprobación se hace bajo un bloqueo de transacción: dos peticiones simultáneas
   * con el mismo nombre no pueden crear las dos. Después del commit invalida las marcas de
   * la tienda (E2-H1); cualquier cambio futuro de marcas (desactivar, renombrar) debe
   * hacer lo mismo.
   */
  async crear(dto: CrearMarcaDto) {
    const marca = await this.prisma.$transaction(async (tx) => {
      await tomarCandado(tx, CANDADOS.MARCAS);
      const repetida = await tx.marca.findFirst({
        where: { nombre: { equals: dto.nombre, mode: 'insensitive' } },
        select: { id: true },
      });
      if (repetida) {
        throw errorDeCampo(
          ConflictException,
          'Ya existe una marca con ese nombre.',
          'nombre',
        );
      }
      return tx.marca.create({ data: { nombre: dto.nombre } });
    });
    await this.cache.invalidar(CLAVES_CACHE.MARCAS);
    return marca;
  }

  /**
   * Borra una marca que ya no se usa (SCRUM-158): ningún producto, cupón ni imagen de la portada
   * la tiene. Si se usa, 409 con dónde. Toma el mismo bloqueo que crear marcas, y después del
   * commit invalida las marcas de la tienda.
   */
  async eliminar(id: number): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tomarCandado(tx, CANDADOS.MARCAS);
        const marca = await tx.marca.findUnique({
          where: { id },
          select: { id: true },
        });
        if (!marca) throw new NotFoundException('La marca no existe.');
        const [productos, cupones, portada] = await Promise.all([
          tx.producto.count({ where: { marcaId: id } }),
          tx.cuponMarca.count({ where: { marcaId: id } }),
          contarEnPortada(tx, TIPOS_DESTINO_PORTADA.MARCA, id),
        ]);
        exigirSinUsos({ productos, cupones, portada }, 'marca');
        await tx.marca.delete({ where: { id } });
      });
    } catch (error) {
      throw traducirUsoSimultaneo(error, 'marca');
    }
    await this.cache.invalidar(CLAVES_CACHE.MARCAS);
  }

  /** Marcas para elegir al crear un producto (E3-H1), ordenadas por nombre. */
  listar(incluirInactivas = false) {
    return this.prisma.marca.findMany({
      where: incluirInactivas ? undefined : { activa: true },
      orderBy: { nombre: 'asc' },
    });
  }
}
