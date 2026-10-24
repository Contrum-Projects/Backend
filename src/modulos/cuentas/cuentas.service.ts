import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import argon2 from 'argon2';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { COLAS, TRABAJOS_CORREO } from '../../colas/colas.js';
import { encolarCorreoConEnlace } from '../../colas/encolar-correo.js';
import { ROLES } from '../../common/dominio/roles.js';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_NOTIFICACION,
  TIPOS_TOKEN,
} from '../../common/dominio/valores.js';
import type { Entorno } from '../../config/entorno.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { RegistrarCuentaDto } from './dto/registrar-cuenta.dto.js';
import { generarTokenCorreo, hashearTokenCorreo } from './tokens.js';

const ASUNTO_CONFIRMACION = 'Confirma tu correo en Cabello Perfecto';

export interface Mensaje {
  mensaje: string;
}

@Injectable()
export class CuentasService {
  private readonly logger = new Logger(CuentasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
    @InjectQueue(COLAS.CORREOS) private readonly correos: Queue,
  ) {}

  /**
   * E1-H1 · Crea la cuenta con el correo sin verificar (no puede comprar hasta
   * confirmarlo) y deja encolado el correo con el enlace de confirmación.
   */
  async registrar(dto: RegistrarCuentaDto): Promise<Mensaje> {
    if (dto.contrasena !== dto.confirmacionContrasena) {
      throw new BadRequestException('Las contraseñas no coinciden.');
    }
    const fechaNacimiento = dto.fechaNacimiento
      ? new Date(`${dto.fechaNacimiento}T00:00:00Z`)
      : undefined;
    if (fechaNacimiento && fechaNacimiento > new Date()) {
      throw new BadRequestException(
        'La fecha de nacimiento no puede ser futura.',
      );
    }

    await this.verificarDatosLibres(dto.email, dto.rut);

    const contrasenaHash = await argon2.hash(dto.contrasena);
    const { token, hash } = generarTokenCorreo();
    const horas = this.config.get('CONFIRMACION_CORREO_HORAS', {
      infer: true,
    });
    const fechaExpiracion = new Date(Date.now() + horas * 60 * 60 * 1000);

    let notificacionId: number;
    try {
      // Cuenta + token + correo registrado en una sola transacción (RNF-12)
      notificacionId = await this.prisma.$transaction(async (tx) => {
        const usuario = await tx.usuario.create({
          data: {
            codigoPublico: randomUUID(),
            nombre: dto.nombre,
            apellido: dto.apellido,
            email: dto.email,
            contrasenaHash,
            rol: ROLES.CLIENTE,
            rut: dto.rut,
            telefono: dto.telefono,
            fechaNacimiento,
            genero: dto.genero,
          },
          select: { id: true },
        });
        await tx.tokenCorreo.create({
          data: {
            usuarioId: usuario.id,
            tipo: TIPOS_TOKEN.CONFIRMACION_CORREO,
            tokenHash: hash,
            fechaExpiracion,
          },
        });
        const notificacion = await tx.notificacion.create({
          data: {
            usuarioId: usuario.id,
            tipo: TIPOS_NOTIFICACION.CONFIRMACION_CORREO,
            asunto: ASUNTO_CONFIRMACION,
            estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
          },
          select: { id: true },
        });
        return notificacion.id;
      });
    } catch (error) {
      // Dos registros simultáneos con el mismo dato: gana el primero
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        await this.verificarDatosLibres(dto.email, dto.rut);
        throw new ConflictException('El correo o el RUT ya está registrado.');
      }
      throw error;
    }

    // Se encola después del commit, nunca dentro de la transacción
    await encolarCorreoConEnlace(
      this.correos,
      TRABAJOS_CORREO.CONFIRMACION_CORREO,
      {
        notificacionId,
        destinatario: dto.email,
        nombre: dto.nombre,
        enlace: this.enlaceConfirmacion(token),
      },
      this.logger,
    );

    return {
      mensaje:
        'Tu cuenta fue creada. Te enviamos un correo para confirmar tu dirección.',
    };
  }

  /**
   * E1-H1 · Marca el correo como verificado si el enlace es vigente y no se usó.
   * El token se consume con una condición atómica para que sea de un solo uso.
   */
  async confirmarCorreo(token: string): Promise<Mensaje> {
    const ahora = new Date();
    const confirmado = await this.prisma.$transaction(async (tx) => {
      const registro = await tx.tokenCorreo.findUnique({
        where: { tokenHash: hashearTokenCorreo(token) },
        select: { id: true, usuarioId: true, tipo: true },
      });
      if (!registro || registro.tipo !== TIPOS_TOKEN.CONFIRMACION_CORREO) {
        return false;
      }

      const { count } = await tx.tokenCorreo.updateMany({
        where: {
          id: registro.id,
          fechaUso: null,
          fechaExpiracion: { gt: ahora },
        },
        data: { fechaUso: ahora },
      });
      if (count === 0) return false;

      await tx.usuario.updateMany({
        where: { id: registro.usuarioId, fechaVerificacionCorreo: null },
        data: { fechaVerificacionCorreo: ahora },
      });
      return true;
    });

    if (!confirmado) {
      throw new BadRequestException(
        'El enlace de confirmación no es válido o ya venció.',
      );
    }
    return { mensaje: 'Tu correo quedó confirmado. Ya puedes comprar.' };
  }

  private async verificarDatosLibres(email: string, rut?: string | null) {
    const existentes = await this.prisma.usuario.findMany({
      where: { OR: [{ email }, ...(rut ? [{ rut }] : [])] },
      select: { email: true, rut: true },
    });
    const correoUsado = existentes.some((u) => u.email === email);
    const rutUsado = !!rut && existentes.some((u) => u.rut === rut);

    if (correoUsado && rutUsado) {
      throw new ConflictException('El correo y el RUT ya están registrados.');
    }
    if (correoUsado) {
      throw new ConflictException('El correo ya está registrado.');
    }
    if (rutUsado) {
      throw new ConflictException('El RUT ya está registrado.');
    }
  }

  private enlaceConfirmacion(token: string): string {
    const base = this.config
      .get('URL_TIENDA', { infer: true })
      .replace(/\/+$/, '');
    return `${base}/confirmar-correo?token=${encodeURIComponent(token)}`;
  }
}
