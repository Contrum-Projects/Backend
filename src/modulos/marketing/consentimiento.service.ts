import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

/** Si la cuenta recibe publicidad y desde cuándo la aceptó (E12-H2). */
export interface ConsentimientoMarketing {
  acepta: boolean;
  /** Última vez que la aceptó; se conserva al desactivarla (decisión del 4 de noviembre de 2026). */
  fechaConsentimiento: string | null;
}

@Injectable()
export class ConsentimientoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * E12-H2 · Guarda si la cuenta con la sesión iniciada recibe ofertas. Activarla guarda la fecha
   * del consentimiento; repetir la activación no la cambia. Cada cambio es una condición atómica
   * sobre el valor anterior, así dos peticiones simultáneas no pisan la fecha.
   *
   * Desactivarla conserva la fecha de la última vez que la aceptó y, por dirección (decisión del
   * equipo del 4 de noviembre de 2026), da de baja también la suscripción sin cuenta con el mismo
   * correo, en la misma transacción: quien no quiere ofertas no las recibe por ningún registro.
   * Activarla no reactiva esa suscripción.
   */
  async actualizar(
    codigoPublico: string,
    acepta: boolean,
  ): Promise<ConsentimientoMarketing> {
    return this.prisma.$transaction(async (tx) => {
      await tx.usuario.updateMany({
        where: { codigoPublico, aceptaMarketingEmail: !acepta },
        data: acepta
          ? {
              aceptaMarketingEmail: true,
              fechaConsentimientoMarketing: new Date(),
            }
          : { aceptaMarketingEmail: false },
      });

      const usuario = await tx.usuario.findUnique({
        where: { codigoPublico },
        select: {
          email: true,
          aceptaMarketingEmail: true,
          fechaConsentimientoMarketing: true,
        },
      });
      if (!usuario) throw new NotFoundException('La cuenta no existe.');

      if (!acepta) {
        // Como la baja desde el correo: la fecha de esta baja invalida enlaces de confirmación anteriores
        await tx.lead.updateMany({
          where: { email: usuario.email },
          data: { activo: false, fechaBaja: new Date() },
        });
      }

      return {
        acepta: usuario.aceptaMarketingEmail,
        fechaConsentimiento:
          usuario.fechaConsentimientoMarketing?.toISOString() ?? null,
      };
    });
  }
}
