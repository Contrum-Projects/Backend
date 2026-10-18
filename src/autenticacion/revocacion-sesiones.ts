import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Sesiones revocadas antes de que caduque su token de acceso (RNF-28, E1-H3). La
 * revocación vive solo en SESION (`fechaRevocacion`) y se consulta en cada
 * petición autenticada: una marca en Redis podría perderse y dejar pasar un token
 * revocado (decisión del 18 oct). La consulta es por índice único. Una cuenta
 * desactivada cuenta como revocada aunque una sesión se haya creado justo al
 * desactivarla (E13-H1).
 */
@Injectable()
export class RevocacionSesiones {
  constructor(private readonly prisma: PrismaService) {}

  /** Si la sesión fue revocada, no existe o su cuenta está desactivada. */
  async estaRevocada(sesion: string): Promise<boolean> {
    const registro = await this.prisma.sesion.findUnique({
      where: { codigoPublico: sesion },
      select: { fechaRevocacion: true, usuario: { select: { activo: true } } },
    });
    return (
      !registro || registro.fechaRevocacion !== null || !registro.usuario.activo
    );
  }
}
