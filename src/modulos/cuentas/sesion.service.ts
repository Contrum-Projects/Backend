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
import {
  ALGORITMO_TOKEN_ACCESO,
  AUDIENCIA_TOKEN_ACCESO,
  type CargaTokenAcceso,
} from '../../autenticacion/carga-token.js';
import type { Rol } from '../../common/dominio/roles.js';
import { duracionAMs } from '../../config/duracion.js';
import type { Entorno } from '../../config/entorno.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { IniciarSesionDto } from './dto/iniciar-sesion.dto.js';
import { IntentosSesion } from './intentos-sesion.js';
import { generarTokenSesion, hashearTokenSesion } from './tokens.js';

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

/** 401 de la renovación: sin sesión vigente que renovar, hay que iniciar sesión de nuevo. */
export class SesionNoRenovableException extends UnauthorizedException {
  constructor() {
    super('Tu sesión no es válida o caducó. Inicia sesión de nuevo.');
  }
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
    const { codigoPublico: sid } = await this.prisma.sesion.create({
      select: { codigoPublico: true },
      data: {
        usuarioId: usuario.id,
        tokenRefrescoHash: hash,
        fechaExpiracion: vencimientoRefresco,
        dispositivo: contexto.dispositivo?.slice(0, LARGO_MAXIMO_DISPOSITIVO),
      },
    });

    const sesion = await this.firmarAcceso(usuario, sid);
    await this.intentos.confirmarExito(dto.email, contexto.ip);

    return { sesion, tokenRefresco, vencimientoRefresco };
  }

  /**
   * Renueva la sesión del dispositivo con su token de refresco: entrega un token de acceso nuevo
   * y cambia el de refresco por otro, así cada token de refresco sirve una sola vez. La sesión
   * debe seguir abierta y vigente, y la cuenta activa con el correo confirmado (RNF-28). El rol
   * se lee de la base, no del token anterior. La vigencia de la sesión no se alarga: vence en la
   * fecha que fijó el inicio de sesión. Si llegan cookies de varias sesiones vigentes (una
   * plantada desde otro subdominio), no se adivina cuál es la real: responde 401.
   */
  async renovar(tokensRefresco: string[]): Promise<ResultadoInicioSesion> {
    const ahora = new Date();
    const vigentes =
      tokensRefresco.length === 0
        ? []
        : await this.prisma.sesion.findMany({
            where: {
              tokenRefrescoHash: { in: tokensRefresco.map(hashearTokenSesion) },
              fechaRevocacion: null,
              fechaExpiracion: { gt: ahora },
              usuario: { activo: true, fechaVerificacionCorreo: { not: null } },
            },
            select: {
              id: true,
              codigoPublico: true,
              tokenRefrescoHash: true,
              fechaExpiracion: true,
              usuario: {
                select: {
                  codigoPublico: true,
                  nombre: true,
                  apellido: true,
                  rol: true,
                },
              },
            },
          });
    if (vigentes.length !== 1) throw new SesionNoRenovableException();
    const [vigente] = vigentes;

    // Cambio atómico: dos renovaciones simultáneas con el mismo token no dan dos tokens válidos
    const { token: tokenRefresco, hash } = generarTokenSesion();
    const { count } = await this.prisma.sesion.updateMany({
      where: {
        id: vigente.id,
        tokenRefrescoHash: vigente.tokenRefrescoHash,
        fechaRevocacion: null,
      },
      data: { tokenRefrescoHash: hash },
    });
    if (count === 0) throw new SesionNoRenovableException();

    return {
      sesion: await this.firmarAcceso(vigente.usuario, vigente.codigoPublico),
      tokenRefresco,
      vencimientoRefresco: vigente.fechaExpiracion,
    };
  }

  /** Firma el token de acceso de la sesión `sid` con el rol de la cuenta (E1-H2, E1-H3). */
  private async firmarAcceso(
    usuario: {
      codigoPublico: string;
      nombre: string;
      apellido: string;
      rol: string;
    },
    sid: string,
  ): Promise<SesionIniciada> {
    const rol = usuario.rol as Rol;
    const expiraEn =
      duracionAMs(this.config.get('JWT_ACCESS_TTL', { infer: true })) / 1000;
    const carga: CargaTokenAcceso = { sub: usuario.codigoPublico, sid, rol };
    const tokenAcceso = await this.jwt.signAsync(carga, {
      expiresIn: expiraEn,
      algorithm: ALGORITMO_TOKEN_ACCESO,
      audience: AUDIENCIA_TOKEN_ACCESO,
    });
    return {
      tokenAcceso,
      expiraEn,
      usuario: {
        codigoPublico: usuario.codigoPublico,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        rol,
      },
    };
  }

  /**
   * E1-H3 · Cierra la sesión del dispositivo dueño del token de refresco. Recibe
   * todos los que llegaron en cookies `refresco` (una plantada desde otro
   * subdominio no deja abierta la real). Es idempotente: sin token, con uno
   * desconocido o ya revocado no hace nada. Desde ese momento el guard rechaza
   * el token de acceso de la sesión.
   */
  async cerrar(tokensRefresco: string[]): Promise<void> {
    if (tokensRefresco.length === 0) return;
    await this.prisma.sesion.updateMany({
      where: {
        tokenRefrescoHash: { in: tokensRefresco.map(hashearTokenSesion) },
        fechaRevocacion: null,
      },
      data: { fechaRevocacion: new Date() },
    });
  }

  /** E1-H3 · Cierra todas las sesiones abiertas de la cuenta, en todos sus dispositivos. */
  async cerrarTodas(codigoPublicoUsuario: string): Promise<void> {
    await this.prisma.sesion.updateMany({
      where: {
        usuario: { codigoPublico: codigoPublicoUsuario },
        fechaRevocacion: null,
      },
      data: { fechaRevocacion: new Date() },
    });
  }
}
