import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Sesiones revocadas antes de que caduque su token de acceso (RNF-28, E1-H3). La
 * revocación vive solo en SESION (`fechaRevocacion`) y se consulta en cada
 * petición autenticada: una marca en Redis podría perderse y dejar pasar un token
 * revocado (decisión del 18 oct). La consulta es por índice único.
 */
@Injectable()
export class RevocacionSesiones {
  constructor(private readonly prisma: PrismaService) {}

  /** Si la sesión fue revocada o no existe. */
  async estaRevocada(sesion: string): Promise<boolean> {
    const registro = await this.prisma.sesion.findUnique({
      where: { codigoPublico: sesion },
      select: { fechaRevocacion: true },
    });
    return !registro || registro.fechaRevocacion !== null;
  }
}
