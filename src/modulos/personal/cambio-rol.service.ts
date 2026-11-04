import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { UsuarioAutenticado } from '../../autenticacion/carga-token.js';
import {
  COLAS,
  TRABAJOS_CORREO,
  type TrabajoRolProfesionalRetirado,
} from '../../colas/colas.js';
import { encolarCorreos } from '../../colas/encolar-correo.js';
import { ROLES, type Rol } from '../../common/dominio/roles.js';
import {
  CANALES_VENTA,
  ESTADOS_NOTIFICACION,
  TIPOS_NOTIFICACION,
} from '../../common/dominio/valores.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { bloquearCuenta } from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CambiarRolDto } from './dto/cambiar-rol.dto.js';

export const ASUNTO_ROL_PROFESIONAL_RETIRADO =
  'Tu cuenta volvió a ser de cliente';
export const NO_EXISTE_CUENTA = 'No existe esa cuenta.';
export const SIN_ACCESO = 'Tu cuenta ya no tiene acceso al panel.';
export const CUENTA_DESACTIVADA = 'La cuenta está desactivada.';
export const ULTIMO_ADMINISTRADOR =
  'No puedes quitarle el rol al único administrador activo: la tienda quedaría sin administrador.';
export const CAMBIO_NO_PERMITIDO =
  'Solo se puede bajar un administrador a vendedor o bodeguero, o un profesional a cliente.';

/** Los únicos cambios de rol de E13-H3: siempre a uno con menos permisos (decisión del 4 nov). */
const DEGRADACIONES: Partial<Record<Rol, readonly Rol[]>> = {
  [ROLES.ADMINISTRADOR]: [ROLES.VENDEDOR, ROLES.BODEGUERO],
  [ROLES.PROFESIONAL]: [ROLES.CLIENTE],
};

export interface CambioRol {
  codigoPublico: string;
  rolAnterior: Rol;
  rol: Rol;
  fechaCambio: Date;
}

/** Artículos que solo se venden al profesional: formatos de productos o packs exclusivos. */
const ARTICULO_EXCLUSIVO = {
  OR: [
    { formato: { producto: { canalVenta: CANALES_VENTA.PROFESIONAL } } },
    { pack: { canalVenta: CANALES_VENTA.PROFESIONAL } },
  ],
} satisfies Prisma.ArticuloVentaWhereInput;

/**
 * Épica 13 · Bajar el rol de una cuenta (E13-H3, RF-13.04). El cambio rige de inmediato: en la
 * misma transacción se guarda el rol, su historial y se cierran todas las sesiones de la cuenta
 * (RNF-28), así la siguiente petición con el token anterior responde 401. Nunca deja la tienda sin
 * administrador. Los pedidos ya creados no se tocan: conservan sus montos (RNF-11).
 */
@Injectable()
export class CambioRolService {
  private readonly logger = new Logger(CambioRolService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(COLAS.CORREOS) private readonly correos: Queue,
  ) {}

  async cambiar(
    codigoPublico: string,
    dto: CambiarRolDto,
    administrador: UsuarioAutenticado,
  ): Promise<CambioRol> {
    const [cambio, correo] = await this.prisma.$transaction(async (tx) => {
      // Bloquea a los administradores activos, como al desactivar (E13-H1): dos cambios
      // simultáneos no pueden dejar la tienda sin administrador
      const administradores = await tx.$queryRaw<
        { id: number; codigoPublico: string }[]
      >`
        SELECT id_usuario AS id, codigo_publico AS "codigoPublico" FROM usuario
        WHERE rol = ${ROLES.ADMINISTRADOR} AND activo
        ORDER BY id_usuario
        FOR UPDATE`;
      // Quien cambia el rol sigue siendo administrador activo: una petición que ya pasó el guard
      // no actúa si le quitaron el rol o la desactivaron mientras esperaba el bloqueo
      const responsable = administradores.find(
        (a) => a.codigoPublico === administrador.codigoPublico,
      );
      if (!responsable) throw new ForbiddenException(SIN_ACCESO);

      const cuentaId = await bloquearCuenta(
        tx,
        codigoPublico,
        NO_EXISTE_CUENTA,
      );
      const cuenta = await tx.usuario.findUniqueOrThrow({
        where: { id: cuentaId },
        select: { rol: true, activo: true, email: true, nombre: true },
      });
      if (!cuenta.activo) throw new ConflictException(CUENTA_DESACTIVADA);
      const rolAnterior = cuenta.rol as Rol;
      if (!DEGRADACIONES[rolAnterior]?.includes(dto.rol)) {
        throw new ConflictException(CAMBIO_NO_PERMITIDO);
      }
      if (
        rolAnterior === ROLES.ADMINISTRADOR &&
        !administradores.some((a) => a.id !== cuentaId)
      ) {
        throw new ConflictException(ULTIMO_ADMINISTRADOR);
      }

      const fechaCambio = new Date();
      await tx.usuario.update({
        where: { id: cuentaId },
        data: { rol: dto.rol },
      });
      await tx.historialRol.create({
        data: {
          usuarioId: cuentaId,
          responsableId: responsable.id,
          rolAnterior,
          rolNuevo: dto.rol,
          motivo: dto.motivo ?? null,
          fechaCambio,
        },
      });
      // RNF-28: el token anterior deja de servir; al volver a entrar, el rol se lee de la base
      await tx.sesion.updateMany({
        where: { usuarioId: cuentaId, fechaRevocacion: null },
        data: { fechaRevocacion: fechaCambio },
      });

      let aviso: TrabajoRolProfesionalRetirado | null = null;
      if (rolAnterior === ROLES.PROFESIONAL) {
        await tx.itemCarrito.deleteMany({
          where: {
            carrito: { usuarioId: cuentaId },
            articulo: ARTICULO_EXCLUSIVO,
          },
        });
        const notificacion = await tx.notificacion.create({
          data: {
            usuarioId: cuentaId,
            tipo: TIPOS_NOTIFICACION.ROL_PROFESIONAL_RETIRADO,
            asunto: ASUNTO_ROL_PROFESIONAL_RETIRADO,
            estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
          },
          select: { id: true },
        });
        aviso = {
          notificacionId: notificacion.id,
          destinatario: cuenta.email,
          nombre: cuenta.nombre,
        };
      }

      const resultado: CambioRol = {
        codigoPublico,
        rolAnterior,
        rol: dto.rol,
        fechaCambio,
      };
      return [resultado, aviso] as const;
    });

    // Después del commit (RNF-12); si Redis no responde, lo reencola la revisión de pendientes
    if (correo) {
      await encolarCorreos(
        this.correos,
        TRABAJOS_CORREO.ROL_PROFESIONAL_RETIRADO,
        [correo],
        this.logger,
      );
    }
    return cambio;
  }
}
