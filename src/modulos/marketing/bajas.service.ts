import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { darDeBajaDireccion } from './baja-direccion.js';

/** Resultado de dar de baja una dirección desde el panel. */
export interface BajaDireccion {
  email: string;
  /** Hay una cuenta con esa dirección. */
  cuenta: boolean;
  /** Hay una suscripción sin cuenta (LEAD) con esa dirección. */
  suscripcion: boolean;
  mensaje: string;
}

@Injectable()
export class BajasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * E12-H2 · El administrador da de baja una dirección cuando la persona lo pide por correo: la
   * cuenta ya no puede hacerlo sola (decisión del equipo del 11 de noviembre de 2026). Es la misma
   * baja por dirección de siempre (`darDeBajaDireccion`): apaga la publicidad de la cuenta y de la
   * suscripción sin cuenta con ese correo en una transacción, y la cuenta conserva la fecha de su
   * último consentimiento. Repetirla responde lo mismo. Si no hay cuenta ni suscripción con esa
   * dirección, 404: el panel debe saber que escribió mal el correo.
   */
  async darDeBaja(email: string): Promise<BajaDireccion> {
    return this.prisma.$transaction(async (tx) => {
      const [cuenta, suscripcion] = await Promise.all([
        tx.usuario.count({ where: { email } }),
        tx.lead.count({ where: { email } }),
      ]);
      if (cuenta === 0 && suscripcion === 0) {
        throw new NotFoundException(
          'No hay ninguna cuenta ni suscripción con ese correo.',
        );
      }
      await darDeBajaDireccion(tx, email, new Date());
      return {
        email,
        cuenta: cuenta > 0,
        suscripcion: suscripcion > 0,
        mensaje: `Listo. ${email} ya no recibirá publicidad.`,
      };
    });
  }
}
