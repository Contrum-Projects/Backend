import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  type OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import type { Rol } from '../../common/dominio/roles.js';
import { duracionAMs } from '../../config/duracion.js';
import type { Entorno } from '../../config/entorno.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { IniciarSesionDto } from './dto/iniciar-sesion.dto.js';
import { IntentosSesion } from './intentos-sesion.js';
import { generarTokenSesion } from './tokens.js';

const LARGO_MAXIMO_DISPOSITIVO = 255;

/** 429 del límite de intentos; lleva la espera para la cabecera Retry-After. */
export class DemasiadosIntentosException extends HttpException {
  constructor(readonly esperaSegundos: number) {
    const minutos = Math.max(1, Math.ceil(esperaSegundos / 60));
    super(
      `Demasiados intentos fallidos. Espera ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} e inténtalo de nuevo.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** Lo que el JWT de acceso lleva: la cuenta (nunca el id) y su rol. */
export interface CargaTokenAcceso {
  sub: string;
  rol: Rol;
}

export interface SesionIniciada {
  tokenAcceso: string;
  /** Segundos de vigencia del token de acceso. */
  expiraEn: number;
  usuario: {
    codigoPublico: string;
    nombre: string;
    apellido: string;
    rol: Rol;
  };
}

export interface ResultadoInicioSesion {
  sesion: SesionIniciada;
  /** Va solo en la cookie httpOnly; en la base queda su hash. */
  tokenRefresco: string;
  vencimientoRefresco: Date;
}

export interface ContextoInicioSesion {
  ip: string;
  dispositivo?: string;
}

@Injectable()
export class SesionService implements OnModuleInit {
  /**
   * Hash de una contraseña que nadie conoce: si el correo no existe se verifica
   * contra él, para que el tiempo de respuesta no delate qué correos están
   * registrados. Usa los mismos parámetros de argon2 que el registro.
   */
  private hashRelleno = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
    private readonly jwt: JwtService,
    private readonly intentos: IntentosSesion,
  ) {}

  async onModuleInit() {
    this.hashRelleno = await argon2.hash(randomBytes(16).toString('hex'));
  }

  /**
   * E1-H2 · Inicia sesión con correo y contraseña. Solo cuentan como fallidos los
   * intentos con correo o contraseña incorrectos; la cuenta desactivada o sin
   * correo confirmado se informa solo cuando la contraseña es correcta.
   */
  async iniciar(
    dto: IniciarSesionDto,
    contexto: ContextoInicioSesion,
  ): Promise<ResultadoInicioSesion> {
    // Reserva el intento antes de verificar: los simultáneos no pasan el límite
    const espera = await this.intentos.reservar(dto.email, contexto.ip);
    if (espera > 0) throw new DemasiadosIntentosException(espera);

    const usuario = await this.prisma.usuario.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        codigoPublico: true,
        nombre: true,
        apellido: true,
        rol: true,
        contrasenaHash: true,
        activo: true,
        fechaVerificacionCorreo: true,
      },
    });
    const contrasenaValida = await argon2.verify(
      usuario?.contrasenaHash ?? this.hashRelleno,
      dto.contrasena,
    );
    if (!usuario || !contrasenaValida) {
      // El intento reservado queda contado como fallido
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }

    if (!usuario.activo) {
      await this.intentos.descontar(dto.email, contexto.ip);
      throw new ForbiddenException('Tu cuenta está desactivada.');
    }
    if (!usuario.fechaVerificacionCorreo) {
      await this.intentos.descontar(dto.email, contexto.ip);
      throw new ForbiddenException(
        'Debes confirmar tu correo antes de iniciar sesión.',
      );
    }

    const { token: tokenRefresco, hash } = generarTokenSesion();
    const vencimientoRefresco = new Date(
      Date.now() +
        duracionAMs(this.config.get('JWT_REFRESH_TTL', { infer: true })),
    );
    await this.prisma.sesion.create({
      data: {
        usuarioId: usuario.id,
        tokenRefrescoHash: hash,
        fechaExpiracion: vencimientoRefresco,
        dispositivo: contexto.dispositivo?.slice(0, LARGO_MAXIMO_DISPOSITIVO),
      },
    });

    const rol = usuario.rol as Rol;
    const expiraEn =
      duracionAMs(this.config.get('JWT_ACCESS_TTL', { infer: true })) / 1000;
    const carga: CargaTokenAcceso = { sub: usuario.codigoPublico, rol };
    const tokenAcceso = await this.jwt.signAsync(carga, {
      expiresIn: expiraEn,
    });

    await this.intentos.confirmarExito(dto.email, contexto.ip);

    return {
      sesion: {
        tokenAcceso,
        expiraEn,
        usuario: {
          codigoPublico: usuario.codigoPublico,
          nombre: usuario.nombre,
          apellido: usuario.apellido,
          rol,
        },
      },
      tokenRefresco,
      vencimientoRefresco,
    };
  }
}
