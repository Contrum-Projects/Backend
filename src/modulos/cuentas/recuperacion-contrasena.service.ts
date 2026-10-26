import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import argon2 from 'argon2';
import type { Queue } from 'bullmq';
import { COLAS, TRABAJOS_CORREO } from '../../colas/colas.js';
import { encolarCorreoConEnlace } from '../../colas/encolar-correo.js';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_NOTIFICACION,
  TIPOS_TOKEN,
} from '../../common/dominio/valores.js';
import type { Entorno } from '../../config/entorno.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { bloquearCuenta } from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Mensaje } from './cuentas.service.js';
import type { RestablecerContrasenaDto } from './dto/restablecer-contrasena.dto.js';
import { SolicitudesRecuperacion } from './solicitudes-recuperacion.js';
import { generarTokenCorreo, hashearTokenCorreo } from './tokens.js';

type Tx = Prisma.TransactionClient;

const ASUNTO_RECUPERACION = 'Recupera tu contraseña de Cabello Perfecto';

/** Misma respuesta con o sin cuenta: no revela qué correos están registrados. */
const SOLICITUD_RECIBIDA =
  'Si el correo tiene una cuenta, te enviamos un enlace para recuperar tu contraseña.';

const ENLACE_INVALIDO =
  'El enlace de recuperación no es válido, ya se usó o venció. Solicita uno nuevo.';

/**
 * Enlaces que dejan de servir al cambiar la contraseña: los demás de recuperación y la
 * invitación del personal (quien recupera ya definió su contraseña).
 */
const TOKENS_DE_CONTRASENA = [
  TIPOS_TOKEN.RECUPERACION_CONTRASENA,
  TIPOS_TOKEN.INVITACION_PERSONAL,
];

@Injectable()
export class RecuperacionContrasenaService {
  private readonly logger = new Logger(RecuperacionContrasenaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
    @InjectQueue(COLAS.CORREOS) private readonly correos: Queue,
    private readonly solicitudes: SolicitudesRecuperacion,
  ) {}

  /**
   * E1-H4 · Si el correo es de una cuenta activa, deja un enlace de un uso con vencimiento
   * (los anteriores dejan de servir) y encola el correo. Sin cuenta, con la cuenta
   * desactivada o pasado el tope por correo, no hace nada y responde lo mismo.
   */
  async solicitar(email: string): Promise<Mensaje> {
    // Se cuenta antes de buscar la cuenta, así el tope no revela si existe
    if (!(await this.solicitudes.reservar(email))) {
      return { mensaje: SOLICITUD_RECIBIDA };
    }
    const usuario = await this.prisma.usuario.findUnique({
      where: { email },
      select: { codigoPublico: true, nombre: true, activo: true },
    });
    if (!usuario?.activo) return { mensaje: SOLICITUD_RECIBIDA };

    const { token, hash } = generarTokenCorreo();
    const horas = this.config.get('RECUPERACION_CONTRASENA_HORAS', {
      infer: true,
    });

    // Token + correo registrado en una transacción (RNF-12), con la cuenta bloqueada para
    // que dos solicitudes simultáneas no dejen dos enlaces vigentes
    const notificacionId = await this.prisma.$transaction(async (tx) => {
      const usuarioId = await bloquearCuenta(tx, usuario.codigoPublico);
      const ahora = new Date();
      await this.invalidarEnlaces(tx, usuarioId, ahora, [
        TIPOS_TOKEN.RECUPERACION_CONTRASENA,
      ]);
      await tx.tokenCorreo.create({
        data: {
          usuarioId,
          tipo: TIPOS_TOKEN.RECUPERACION_CONTRASENA,
          tokenHash: hash,
          fechaExpiracion: new Date(ahora.getTime() + horas * 60 * 60 * 1000),
        },
      });
      const notificacion = await tx.notificacion.create({
        data: {
          usuarioId,
          tipo: TIPOS_NOTIFICACION.RECUPERACION_CONTRASENA,
          asunto: ASUNTO_RECUPERACION,
          estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
        },
        select: { id: true },
      });
      return notificacion.id;
    });

    // Se encola después del commit, nunca dentro de la transacción
    await encolarCorreoConEnlace(
      this.correos,
      TRABAJOS_CORREO.RECUPERACION_CONTRASENA,
      {
        notificacionId,
        destinatario: email,
        nombre: usuario.nombre,
        enlace: this.enlaceRecuperacion(token),
      },
      this.logger,
    );

    return { mensaje: SOLICITUD_RECIBIDA };
  }

  /**
   * E1-H4 · Guarda la contraseña nueva si el enlace es vigente y no se usó, y lo deja sin
   * efecto. En la misma transacción confirma el correo (el enlace prueba que es suyo),
   * invalida los demás enlaces de contraseña y cierra todas las sesiones (RNF-28).
   */
  async restablecer(dto: RestablecerContrasenaDto): Promise<Mensaje> {
    if (dto.contrasena !== dto.confirmacionContrasena) {
      throw new BadRequestException('Las contraseñas no coinciden.');
    }
    // Primero el token (barato): un token inventado no gasta un hash de argon2
    const registro = await this.prisma.tokenCorreo.findUnique({
      where: { tokenHash: hashearTokenCorreo(dto.token) },
      select: { id: true, usuarioId: true, tipo: true },
    });
    if (!registro || registro.tipo !== TIPOS_TOKEN.RECUPERACION_CONTRASENA) {
      throw new BadRequestException(ENLACE_INVALIDO);
    }
    const contrasenaHash = await argon2.hash(dto.contrasena);
    const ahora = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Consumo atómico: el enlace sirve una sola vez
      const consumido = await tx.tokenCorreo.updateMany({
        where: {
          id: registro.id,
          fechaUso: null,
          fechaExpiracion: { gt: ahora },
        },
        data: { fechaUso: ahora },
      });
      if (consumido.count === 0) throw new BadRequestException(ENLACE_INVALIDO);

      // Una cuenta desactivada después de pedir el enlace no cambia (se deshace el consumo)
      const cambiada = await tx.usuario.updateMany({
        where: { id: registro.usuarioId, activo: true },
        data: { contrasenaHash },
      });
      if (cambiada.count === 0) throw new BadRequestException(ENLACE_INVALIDO);

      await tx.usuario.updateMany({
        where: { id: registro.usuarioId, fechaVerificacionCorreo: null },
        data: { fechaVerificacionCorreo: ahora },
      });
      await this.invalidarEnlaces(
        tx,
        registro.usuarioId,
        ahora,
        TOKENS_DE_CONTRASENA,
      );
      await tx.sesion.updateMany({
        where: { usuarioId: registro.usuarioId, fechaRevocacion: null },
        data: { fechaRevocacion: ahora },
      });
    });

    return {
      mensaje: 'Tu contraseña quedó actualizada. Ya puedes iniciar sesión.',
    };
  }

  /** Vence de inmediato los enlaces de esos tipos aún sin usar. */
  private async invalidarEnlaces(
    tx: Tx,
    usuarioId: number,
    ahora: Date,
    tipos: string[],
  ) {
    await tx.tokenCorreo.updateMany({
      where: {
        usuarioId,
        tipo: { in: tipos },
        fechaUso: null,
        fechaExpiracion: { gt: ahora },
      },
      data: { fechaExpiracion: ahora },
    });
  }

  private enlaceRecuperacion(token: string): string {
    const base = this.config
      .get('URL_TIENDA', { infer: true })
      .replace(/\/+$/, '');
    return `${base}/restablecer-contrasena?token=${encodeURIComponent(token)}`;
  }
}
