import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { FirmaSeguimiento } from './firma-seguimiento.js';

/**
 * Registro de aperturas y clics de la publicidad (E12-H6 · CA1). Lo que se muestra o a dónde se
 * redirige nunca depende de que el registro funcione: una firma inválida o una base caída solo
 * dejan de registrar, así nadie deduce nada probando enlaces y nadie queda con una imagen rota o
 * un enlace que no lleva a ninguna parte.
 */
@Injectable()
export class SeguimientoService {
  private readonly logger = new Logger(SeguimientoService.name);
  private readonly urlTienda: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly firma: FirmaSeguimiento,
    config: ConfigService<Entorno, true>,
  ) {
    this.urlTienda = config
      .get('URL_TIENDA', { infer: true })
      .replace(/\/+$/, '');
  }

  /** E12-H6 · CA1: guarda la fecha de la **primera** apertura; las siguientes no la cambian. */
  async registrarApertura(token: string): Promise<void> {
    const id = this.firma.verificarApertura(token);
    if (id === null) return;
    await this.registrar(id, 'la apertura', async (ahora) => {
      await this.prisma.notificacion.updateMany({
        where: { id, fechaApertura: null },
        data: { fechaApertura: ahora },
      });
    });
  }

  /**
   * E12-H6 · CA1: guarda la fecha del **primer** clic y devuelve a dónde redirigir. Un clic también
   * cuenta como apertura si la imagen no se cargó (muchos programas de correo la bloquean). Solo se
   * redirige al destino firmado, y solo si es de la tienda: otro destino o una firma inválida
   * llevan a su portada, así la API no sirve para saltar a cualquier página (auditoría del 5 nov).
   */
  async registrarClic(token: string, destino: unknown): Promise<string> {
    const url = typeof destino === 'string' ? destino : '';
    if (!this.esDeLaTienda(url)) return this.urlTienda;

    const id = this.firma.verificarClic(token, url);
    if (id === null) return this.urlTienda;

    await this.registrar(id, 'el clic', async (ahora) => {
      await this.prisma.$transaction([
        this.prisma.notificacion.updateMany({
          where: { id, fechaClic: null },
          data: { fechaClic: ahora },
        }),
        this.prisma.notificacion.updateMany({
          where: { id, fechaApertura: null },
          data: { fechaApertura: ahora },
        }),
      ]);
    });
    return url;
  }

  /** Misma tienda y misma raíz: `https://tienda.cl.otro.com` no pasa por `https://tienda.cl`. */
  private esDeLaTienda(url: string): boolean {
    return url === this.urlTienda || url.startsWith(`${this.urlTienda}/`);
  }

  private async registrar(
    id: number,
    accion: string,
    guardar: (ahora: Date) => Promise<void>,
  ): Promise<void> {
    try {
      await guardar(new Date());
    } catch (error) {
      this.logger.warn(
        `No se pudo registrar ${accion} de la notificación ${id}: ${(error as Error).message}`,
      );
    }
  }
}
