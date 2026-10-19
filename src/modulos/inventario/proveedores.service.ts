import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CrearProveedorDto } from './dto/crear-proveedor.dto.js';

@Injectable()
export class ProveedoresService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra un proveedor (E11-H1). El RUT llega normalizado y validado por el DTO.
   * La unicidad la decide la restricción UNIQUE de `proveedor.rut`, no una consulta
   * previa: dos peticiones simultáneas con el mismo RUT no pueden crear las dos.
   */
  async crear(dto: CrearProveedorDto) {
    try {
      return await this.prisma.proveedor.create({
        data: {
          rut: dto.rut,
          razonSocial: dto.razonSocial,
          nombreContacto: dto.nombreContacto,
          telefono: dto.telefono,
          email: dto.email,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ya existe un proveedor con ese RUT.');
      }
      throw error;
    }
  }

  /** Proveedores para elegir al registrar una entrada de inventario (E11-H2). */
  listar(incluirInactivos = false) {
    return this.prisma.proveedor.findMany({
      where: incluirInactivos ? undefined : { activo: true },
      orderBy: { razonSocial: 'asc' },
    });
  }
}
