import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  COLAS,
  TRABAJOS_CORREO,
  type TrabajoCumpleanos,
} from '../../colas/colas.js';
import { encolarCorreos } from '../../colas/encolar-correo.js';
import { ROLES_COMPRADOR } from '../../common/dominio/roles.js';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_CAMPANA,
  TIPOS_NOTIFICACION,
} from '../../common/dominio/valores.js';
import { bloquearCuenta } from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  anioEnLaTienda,
  cumpleanosDeHoy,
  esCumpleanosHoy,
  esHoraDeSaludar,
  inicioDelAnio,
  puedeRecibirSaludo,
} from './regla-cumpleanos.js';
import { leerActivo, SALUDO_POR_DEFECTO } from './saludo-cumpleanos.js';

const LOTE_CUENTAS = 100;

interface Candidata {
  id: number;
  codigoPublico: string;
}

/**
 * Saludos de cumpleaños (E12-H5, RF-12.10 y RF-12.11). Lo hace una tarea periódica con lo guardado
 * en la base: el saludo de cada año queda en NOTIFICACION (`cumpleanos`), así una pasada perdida
 * la alcanza la siguiente del mismo día y ninguna saluda dos veces (RNF-29, RNF-20).
 */
@Injectable()
export class SaludosCumpleanosService {
  private readonly logger = new Logger(SaludosCumpleanosService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(COLAS.CORREOS) private readonly correos: Queue,
  ) {}

  /**
   * Recorre las cuentas que están de cumpleaños hoy en Chile, aceptan publicidad y no tienen su
   * saludo de este año. Antes de las 9:00 no hace nada. Una falla solo afecta a su cuenta, que se
   * reintenta en la pasada siguiente.
   */
  async enviarSaludos(ahora = new Date()): Promise<void> {
    if (!esHoraDeSaludar(ahora)) return;
    if (!(await this.saludoActivo())) return;
    const dias = cumpleanosDeHoy(ahora);
    const anio = anioEnLaTienda(ahora);
    let ultimoId = 0;
    for (;;) {
      const cuentas = await this.prisma.$queryRaw<Candidata[]>`
        SELECT u.id_usuario AS id, u.codigo_publico AS "codigoPublico"
        FROM usuario u
        WHERE u.id_usuario > ${ultimoId}
          AND u.activo
          AND u.rol = ANY(${[...ROLES_COMPRADOR]}::text[])
          AND u.acepta_marketing_email
          AND u.fecha_verificacion_correo IS NOT NULL
          AND u.fecha_nacimiento IS NOT NULL
          AND to_char(u.fecha_nacimiento, 'MM-DD') = ANY(${dias}::text[])
          AND NOT EXISTS (
            SELECT 1 FROM notificacion n
            WHERE n.id_usuario = u.id_usuario
              AND n.tipo = ${TIPOS_NOTIFICACION.CUMPLEANOS}
              AND n.fecha_creacion >= ${inicioDelAnio(anio)}
          )
        ORDER BY u.id_usuario
        LIMIT ${LOTE_CUENTAS}`;

      for (const cuenta of cuentas) {
        try {
          await this.saludar(cuenta.codigoPublico, ahora);
        } catch (error) {
          this.logger.error(
            `No se pudo saludar a la cuenta ${cuenta.id}: ${(error as Error).message}`,
          );
        }
      }

      if (cuentas.length < LOTE_CUENTAS) return;
      ultimoId = cuentas[cuentas.length - 1].id;
    }
  }

  /** SCRUM-150 · Apagado por el administrador, no sale ningún saludo. Sin configurar, sale el por defecto. */
  private async saludoActivo(): Promise<boolean> {
    const configurado = await this.prisma.campana.findFirst({
      where: { tipo: TIPOS_CAMPANA.CUMPLEANOS },
      orderBy: { id: 'asc' },
      select: { segmento: true },
    });
    return !configurado || leerActivo(configurado.segmento);
  }

  /**
   * Con la cuenta bloqueada: dos instancias o dos pasadas solapadas no la saludan dos veces, y un
   * cambio del consentimiento o de la fecha que esperaba el bloqueo se ve aquí (CA3). La
   * NOTIFICACION se crea en la transacción y el correo se encola después del commit (RNF-12).
   */
  private async saludar(codigoPublico: string, ahora: Date): Promise<void> {
    const correo = await this.prisma.$transaction(async (tx) => {
      const id = await bloquearCuenta(tx, codigoPublico);
      const cuenta = await tx.usuario.findUnique({
        where: { id },
        select: {
          email: true,
          nombre: true,
          activo: true,
          rol: true,
          aceptaMarketingEmail: true,
          fechaVerificacionCorreo: true,
          fechaNacimiento: true,
        },
      });
      if (!cuenta || !puedeRecibirSaludo(cuenta)) return null;
      if (!esCumpleanosHoy(cuenta.fechaNacimiento, ahora)) return null;
      // Una sola vez en el año (CA1): cuenta el saludo en cualquier estado, también uno cancelado
      const saludos = await tx.notificacion.count({
        where: {
          usuarioId: id,
          tipo: TIPOS_NOTIFICACION.CUMPLEANOS,
          fechaCreacion: { gte: inicioDelAnio(anioEnLaTienda(ahora)) },
        },
      });
      if (saludos > 0) return null;

      const configurado = await tx.campana.findFirst({
        where: { tipo: TIPOS_CAMPANA.CUMPLEANOS },
        orderBy: { id: 'asc' },
        select: { id: true, asunto: true, segmento: true },
      });
      // SCRUM-150: el saludo se pudo apagar mientras esta pasada recorría las cuentas
      if (configurado && !leerActivo(configurado.segmento)) return null;
      const notificacion = await tx.notificacion.create({
        data: {
          usuarioId: id,
          campanaId: configurado?.id ?? null,
          tipo: TIPOS_NOTIFICACION.CUMPLEANOS,
          asunto: configurado?.asunto ?? SALUDO_POR_DEFECTO.asunto,
          estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
        },
        select: { id: true },
      });
      const datos: TrabajoCumpleanos = {
        notificacionId: notificacion.id,
        destinatario: cuenta.email,
        nombre: cuenta.nombre,
      };
      return datos;
    });

    if (!correo) return;
    await encolarCorreos(
      this.correos,
      TRABAJOS_CORREO.CUMPLEANOS,
      [correo],
      this.logger,
    );
  }
}
