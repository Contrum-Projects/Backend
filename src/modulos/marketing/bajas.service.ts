import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { FirmaBaja } from './firma-baja.js';
import type { Mensaje } from './suscripciones.service.js';

/**
 * Mismo mensaje haya o no una cuenta o una suscripción con esa dirección, y aunque ya estuviera de
 * baja: la baja se puede repetir sin error.
 */
export const MENSAJE_BAJA =
  'Listo. Dejaremos de enviarte publicidad a este correo.';

@Injectable()
export class BajasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firma: FirmaBaja,
  ) {}

  /**
   * E12-H2 · Baja desde un correo publicitario, por dirección (decisión del 4 de noviembre de 2026):
   * apaga la publicidad de la cuenta y la suscripción sin cuenta que tengan ese correo, en una sola
   * transacción. La suscripción queda de baja con la fecha de esta baja aunque estuviera pendiente
   * o ya de baja: así ningún enlace de confirmación anterior la activa (E12-H1), ni uno pedido
   * después de una baja previa. La cuenta conserva la fecha del último consentimiento.
   */
  async darDeBaja(token: string): Promise<Mensaje> {
    const email = this.firma.verificar(token);
    if (!email) {
      throw new BadRequestException('El enlace de baja no es válido.');
    }

    const ahora = new Date();
    await this.prisma.$transaction([
      this.prisma.lead.updateMany({
        where: { email },
        data: { activo: false, fechaBaja: ahora },
      }),
      this.prisma.usuario.updateMany({
        where: { email, aceptaMarketingEmail: true },
        data: { aceptaMarketingEmail: false },
      }),
    ]);
    return { mensaje: MENSAJE_BAJA };
  }
}
