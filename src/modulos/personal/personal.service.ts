import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import argon2 from 'argon2';
import type { Queue } from 'bullmq';
import { randomBytes, randomUUID } from 'node:crypto';
import type { UsuarioAutenticado } from '../../autenticacion/carga-token.js';
import { COLAS, TRABAJOS_CORREO } from '../../colas/colas.js';
import { encolarCorreoConEnlace } from '../../colas/encolar-correo.js';
import { ROLES, ROLES_PERSONAL, type Rol } from '../../common/dominio/roles.js';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_NOTIFICACION,
  TIPOS_TOKEN,
} from '../../common/dominio/valores.js';
import type { Entorno } from '../../config/entorno.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Mensaje } from '../cuentas/cuentas.service.js';
import { generarTokenCorreo, hashearTokenCorreo } from '../cuentas/tokens.js';
import type { AceptarInvitacionDto } from './dto/aceptar-invitacion.dto.js';
import type { CrearPersonalDto } from './dto/crear-personal.dto.js';

const ASUNTO_INVITACION = 'Te invitamos al panel de Cabello Perfecto';
const ENLACE_INVALIDO = 'El enlace de invitación no es válido o ya venció.';
const SIN_ACCESO = 'Tu cuenta ya no tiene acceso al panel.';

type Tx = Prisma.TransactionClient;

export interface CuentaPersonal {
  codigoPublico: string;
  nombre: string;
  apellido: string;
  email: string;
  rol: Rol;
  activo: boolean;
  /** Aún no define su contraseña con el enlace de la invitación. */
  invitacionPendiente: boolean;
}

const SELECCION_CUENTA = {
  codigoPublico: true,
  nombre: true,
  apellido: true,
  email: true,
  rol: true,
  activo: true,
  fechaVerificacionCorreo: true,
} as const;

const aCuentaPersonal = ({
  fechaVerificacionCorreo,
  rol,
  ...cuenta
}: Prisma.UsuarioGetPayload<{
  select: typeof SELECCION_CUENTA;
}>): CuentaPersonal => ({
  ...cuenta,
  rol: rol as Rol,
  invitacionPendiente: fechaVerificacionCorreo === null,
});

/** El correo de la invitación, listo para encolar después del commit. */
interface InvitacionCreada {
  notificacionId: number;
  token: string;
}

/**
 * Épica 13 · Cuentas del personal de tienda (E13-H1). El administrador las crea con
 * un único rol y una invitación por correo para que cada persona defina su
 * contraseña; al desactivarlas se cierran sus sesiones de inmediato (RNF-28).
 */
@Injectable()
export class PersonalService {
  private readonly logger = new Logger(PersonalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
    @InjectQueue(COLAS.CORREOS) private readonly correos: Queue,
  ) {}

  /** Cuentas del personal, activas y desactivadas, por apellido. */
  async listar(): Promise<CuentaPersonal[]> {
    const cuentas = await this.prisma.usuario.findMany({
      where: { rol: { in: [...ROLES_PERSONAL] } },
      select: SELECCION_CUENTA,
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
    });
    return cuentas.map(aCuentaPersonal);
  }

  /**
   * E13-H1 · Crea la cuenta con ese único rol y una contraseña aleatoria que nadie
   * conoce, y envía la invitación para que la persona defina la suya.
   */
  async crear(
    dto: CrearPersonalDto,
    administrador: UsuarioAutenticado,
  ): Promise<CuentaPersonal> {
    await this.verificarCorreoLibre(dto.email);
    const contrasenaHash = await argon2.hash(
      randomBytes(32).toString('base64url'),
    );

    let cuenta: CuentaPersonal;
    let invitacion: InvitacionCreada;
    try {
      // Cuenta + token + correo registrado en una sola transacción (RNF-12)
      [cuenta, invitacion] = await this.prisma.$transaction(async (tx) => {
        await this.exigirAdministradorActivo(tx, administrador);
        const usuario = await tx.usuario.create({
          data: {
            codigoPublico: randomUUID(),
            nombre: dto.nombre,
            apellido: dto.apellido,
            email: dto.email,
            contrasenaHash,
            rol: dto.rol,
          },
          select: { id: true, ...SELECCION_CUENTA },
        });
        const { id, ...datos } = usuario;
        return [aCuentaPersonal(datos), await this.crearInvitacion(tx, id)];
      });
    } catch (error) {
      // Dos creaciones simultáneas con el mismo correo: gana la primera
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('El correo ya está registrado.');
      }
      throw error;
    }

    await this.encolarInvitacion(invitacion, cuenta);
    return cuenta;
  }

  /**
   * Envía una invitación nueva a una cuenta que aún no define su contraseña; el
   * enlace anterior deja de servir.
   */
  async reenviarInvitacion(
    codigoPublico: string,
    administrador: UsuarioAutenticado,
  ): Promise<void> {
    const [cuenta, invitacion] = await this.prisma.$transaction(async (tx) => {
      await this.exigirAdministradorActivo(tx, administrador);
      // Bloquea la cuenta: no se cruza con una aceptación o desactivación en curso
      await tx.$queryRaw`
        SELECT id_usuario FROM usuario
        WHERE codigo_publico = ${codigoPublico}
        FOR UPDATE`;
      const usuario = await this.buscarPersonal(tx, codigoPublico);
      if (!usuario.activo) {
        throw new ConflictException('La cuenta está desactivada.');
      }
      if (usuario.fechaVerificacionCorreo) {
        throw new ConflictException('Esta cuenta ya definió su contraseña.');
      }
      await this.invalidarInvitaciones(tx, usuario.id);
      const { id, ...datos } = usuario;
      return [aCuentaPersonal(datos), await this.crearInvitacion(tx, id)];
    });
    await this.encolarInvitacion(invitacion, cuenta);
  }

  /**
   * E13-H1 · Define la contraseña con el enlace de la invitación y confirma el
   * correo. El token es de un uso y la cuenta debe seguir activa.
   */
  async aceptarInvitacion(dto: AceptarInvitacionDto): Promise<Mensaje> {
    if (dto.contrasena !== dto.confirmacionContrasena) {
      throw new BadRequestException('Las contraseñas no coinciden.');
    }
    // Primero el token (barato): un token inventado no gasta un hash de argon2
    const registro = await this.prisma.tokenCorreo.findUnique({
      where: { tokenHash: hashearTokenCorreo(dto.token) },
      select: { id: true, usuarioId: true, tipo: true },
    });
    if (!registro || registro.tipo !== TIPOS_TOKEN.INVITACION_PERSONAL) {
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
      const definida = await tx.usuario.updateMany({
        where: {
          id: registro.usuarioId,
          activo: true,
          fechaVerificacionCorreo: null,
        },
        data: { contrasenaHash, fechaVerificacionCorreo: ahora },
      });
      if (consumido.count === 0 || definida.count === 0) {
        throw new BadRequestException(ENLACE_INVALIDO);
      }
    });

    return {
      mensaje: 'Tu contraseña quedó definida. Ya puedes iniciar sesión.',
    };
  }

  /**
   * E13-H1 · Desactiva la cuenta, cierra todas sus sesiones e invalida su
   * invitación pendiente, en una transacción. Desde ese momento su token de
   * acceso deja de servir y no puede iniciar sesión. Siempre queda al menos un
   * administrador activo (quien desactiva).
   */
  async desactivar(
    codigoPublico: string,
    administrador: UsuarioAutenticado,
  ): Promise<void> {
    if (codigoPublico === administrador.codigoPublico) {
      throw new ConflictException('No puedes desactivar tu propia cuenta.');
    }

    await this.prisma.$transaction(async (tx) => {
      // Bloquea a los administradores activos: dos desactivaciones simultáneas
      // no pueden dejar el panel sin administrador
      const administradores = await tx.$queryRaw<{ codigoPublico: string }[]>`
        SELECT codigo_publico AS "codigoPublico" FROM usuario
        WHERE rol = ${ROLES.ADMINISTRADOR} AND activo
        ORDER BY id_usuario
        FOR UPDATE`;
      // Quien desactiva sigue activo: una petición que ya pasó el guard no
      // actúa si su cuenta se desactivó mientras esperaba el bloqueo. Como
      // tampoco puede desactivarse a sí mismo, siempre queda al menos un
      // administrador activo: él.
      if (
        !administradores.some(
          (a) => a.codigoPublico === administrador.codigoPublico,
        )
      ) {
        throw new ForbiddenException(SIN_ACCESO);
      }

      const usuario = await this.buscarPersonal(tx, codigoPublico);
      if (!usuario.activo) return;

      const ahora = new Date();
      await tx.usuario.update({
        where: { id: usuario.id },
        data: { activo: false },
      });
      await tx.sesion.updateMany({
        where: { usuarioId: usuario.id, fechaRevocacion: null },
        data: { fechaRevocacion: ahora },
      });
      await this.invalidarInvitaciones(tx, usuario.id, ahora);
    });
  }

  /**
   * El administrador que hace la petición sigue activo. Comparte el bloqueo con
   * `desactivar` (FOR SHARE frente a FOR UPDATE): si lo están desactivando,
   * espera y luego responde 403.
   */
  private async exigirAdministradorActivo(
    tx: Tx,
    administrador: UsuarioAutenticado,
  ) {
    const filas = await tx.$queryRaw<{ id: number }[]>`
      SELECT id_usuario AS id FROM usuario
      WHERE codigo_publico = ${administrador.codigoPublico}
        AND rol = ${ROLES.ADMINISTRADOR} AND activo
      FOR SHARE`;
    if (filas.length === 0) throw new ForbiddenException(SIN_ACCESO);
  }

  private async buscarPersonal(tx: Tx, codigoPublico: string) {
    const usuario = await tx.usuario.findFirst({
      where: { codigoPublico, rol: { in: [...ROLES_PERSONAL] } },
      select: { id: true, ...SELECCION_CUENTA },
    });
    if (!usuario) {
      throw new NotFoundException('No existe esa cuenta del personal.');
    }
    return usuario;
  }

  private async verificarCorreoLibre(email: string) {
    const existente = await this.prisma.usuario.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existente) throw new ConflictException('El correo ya está registrado.');
  }

  /** Token de la invitación + NOTIFICACION pendiente, dentro de la transacción. */
  private async crearInvitacion(
    tx: Tx,
    usuarioId: number,
  ): Promise<InvitacionCreada> {
    const { token, hash } = generarTokenCorreo();
    const horas = this.config.get('INVITACION_PERSONAL_HORAS', {
      infer: true,
    });
    await tx.tokenCorreo.create({
      data: {
        usuarioId,
        tipo: TIPOS_TOKEN.INVITACION_PERSONAL,
        tokenHash: hash,
        fechaExpiracion: new Date(Date.now() + horas * 60 * 60 * 1000),
      },
    });
    const notificacion = await tx.notificacion.create({
      data: {
        usuarioId,
        tipo: TIPOS_NOTIFICACION.INVITACION_PERSONAL,
        asunto: ASUNTO_INVITACION,
        estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
      },
      select: { id: true },
    });
    return { notificacionId: notificacion.id, token };
  }

  /** Vence de inmediato los enlaces de invitación aún sin usar. */
  private async invalidarInvitaciones(
    tx: Tx,
    usuarioId: number,
    ahora = new Date(),
  ) {
    await tx.tokenCorreo.updateMany({
      where: {
        usuarioId,
        tipo: TIPOS_TOKEN.INVITACION_PERSONAL,
        fechaUso: null,
        fechaExpiracion: { gt: ahora },
      },
      data: { fechaExpiracion: ahora },
    });
  }

  private async encolarInvitacion(
    { notificacionId, token }: InvitacionCreada,
    cuenta: CuentaPersonal,
  ) {
    const base = this.config
      .get('URL_TIENDA', { infer: true })
      .replace(/\/+$/, '');
    await encolarCorreoConEnlace(
      this.correos,
      TRABAJOS_CORREO.INVITACION_PERSONAL,
      {
        notificacionId,
        destinatario: cuenta.email,
        nombre: cuenta.nombre,
        enlace: `${base}/personal/activar?token=${encodeURIComponent(token)}`,
      },
      this.logger,
    );
  }
}
