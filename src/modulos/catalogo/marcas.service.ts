import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CacheCatalogo, CLAVES_CACHE } from './cache-catalogo.js';
import type { CrearMarcaDto } from './dto/crear-marca.dto.js';

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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(3401)`;
      const repetida = await tx.marca.findFirst({
        where: { nombre: { equals: dto.nombre, mode: 'insensitive' } },
        select: { id: true },
      });
      if (repetida) {
        throw new ConflictException('Ya existe una marca con ese nombre.');
      }
      return tx.marca.create({ data: { nombre: dto.nombre } });
    });
    await this.cache.invalidar(CLAVES_CACHE.MARCAS);
    return marca;
  }

  /** Marcas para elegir al crear un producto (E3-H1), ordenadas por nombre. */
  listar(incluirInactivas = false) {
    return this.prisma.marca.findMany({
      where: incluirInactivas ? undefined : { activa: true },
      orderBy: { nombre: 'asc' },
    });
  }
}
