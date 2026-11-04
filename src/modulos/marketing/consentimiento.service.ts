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
   * del consentimiento; repetir la activación no la cambia. Desactivarla conserva la fecha de la
   * última vez que la aceptó. Cada cambio es una condición atómica sobre el valor anterior, así dos
   * peticiones simultáneas no pisan la fecha.
   */
  async actualizar(
    codigoPublico: string,
    acepta: boolean,
  ): Promise<ConsentimientoMarketing> {
    await this.prisma.usuario.updateMany({
      where: { codigoPublico, aceptaMarketingEmail: !acepta },
      data: acepta
        ? {
            aceptaMarketingEmail: true,
            fechaConsentimientoMarketing: new Date(),
          }
        : { aceptaMarketingEmail: false },
    });

    const usuario = await this.prisma.usuario.findUnique({
      where: { codigoPublico },
      select: {
        aceptaMarketingEmail: true,
        fechaConsentimientoMarketing: true,
      },
    });
    if (!usuario) throw new NotFoundException('La cuenta no existe.');
    return {
      acepta: usuario.aceptaMarketingEmail,
      fechaConsentimiento:
        usuario.fechaConsentimientoMarketing?.toISOString() ?? null,
    };
  }
}
