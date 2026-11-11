import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { UsuarioAutenticado } from '../../autenticacion/carga-token.js';
import {
  ROLES,
  ROLES_COMPRADOR,
  type Rol,
} from '../../common/dominio/roles.js';
import { normalizarRut } from '../../common/dominio/rut.js';
import { POR_PAGINA } from '../../common/validacion/paginacion.js';
import { escaparComodines } from '../../common/validacion/texto-busqueda.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { bloquearCuenta } from '../../prisma/bloqueos.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  ClienteDetalleDto,
  ClienteListadoDto,
  ListadoClientesDto,
} from './dto/cliente-respuesta.dto.js';
import type { ListarClientesDto } from './dto/listar-clientes.dto.js';

export const NO_EXISTE_CLIENTE =
  'No existe esa cuenta de cliente o profesional.';
const SIN_ACCESO = 'Tu cuenta ya no tiene acceso al panel.';

type Tx = Prisma.TransactionClient;
type RolComprador = ClienteListadoDto['rol'];
/** La fila como objeto plano (el DTO es una clase solo para Swagger). */
type ClienteListado = { [K in keyof ClienteListadoDto]: ClienteListadoDto[K] };

/** Solo quienes compran: el personal se gestiona en `PersonalService`. */
const DE_COMPRADOR = {
  rol: { in: [...ROLES_COMPRADOR] },
} satisfies Prisma.UsuarioWhereInput;

const SELECCION_LISTADO = {
  codigoPublico: true,
  nombre: true,
  apellido: true,
  email: true,
  rut: true,
  rol: true,
  activo: true,
  fechaRegistro: true,
  fechaVerificacionCorreo: true,
} as const satisfies Prisma.UsuarioSelect;

const aClienteListado = ({
  fechaVerificacionCorreo,
  rol,
  ...cuenta
}: Prisma.UsuarioGetPayload<{
  select: typeof SELECCION_LISTADO;
}>): ClienteListado => ({
  ...cuenta,
  rol: rol as RolComprador,
  correoConfirmado: fechaVerificacionCorreo !== null,
});

/** Más recientes primero; el id desempata dos registros del mismo instante. */
const ORDEN: Prisma.UsuarioOrderByWithRelationInput[] = [
  { fechaRegistro: 'desc' },
  { id: 'desc' },
];

/**
 * Condición de la búsqueda (`?buscar=`). Un RUT válido, con o sin puntos y guion, busca esa
 * cuenta; si no, cada palabra debe estar en el nombre, el apellido, el correo o el RUT.
 */
export const condicionBusqueda = (
  buscar: string | undefined,
): Prisma.UsuarioWhereInput => {
  const palabras = buscar?.split(/\s+/).filter(Boolean) ?? [];
  if (palabras.length === 0) return {};

  const porPalabras: Prisma.UsuarioWhereInput = {
    AND: palabras.map((palabra) => {
      const texto = {
        contains: escaparComodines(palabra),
        mode: 'insensitive' as const,
      };
      // El RUT se guarda sin puntos (`12345678-K`): se quitan de lo escrito
      const rut = palabra.replace(/\./g, '');
      return {
        OR: [
          { nombre: texto },
          { apellido: texto },
          { email: texto },
          ...(rut
            ? [
                {
                  rut: {
                    contains: escaparComodines(rut),
                    mode: 'insensitive' as const,
                  },
                },
              ]
            : []),
        ],
      };
    }),
  };
  const rut = normalizarRut(buscar ?? '');
  return rut ? { OR: [{ rut }, porPalabras] } : porPalabras;
};

/**
 * Épica 13 · Clientes y profesionales en el panel (E13-H4, SCRUM-154). El administrador los
 * busca, ve su detalle y los desactiva o reactiva. Desactivar solo corta el acceso: cierra sus
 * sesiones de inmediato (RNF-28) y no toca pedidos, carrito, verificación ni suscripciones
 * (decisión del 11 nov). Quitar el rol profesional es `PATCH /api/cuentas/:codigoPublico/rol`
 * (E13-H3).
 */
@Injectable()
export class ClientesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cuentas de clientes y profesionales, más recientes primero, con la búsqueda y los filtros de
   * rol y estado. `conteos` cuenta cada filtro con la búsqueda aplicada.
   */
  async listar(filtros: ListarClientesDto): Promise<ListadoClientesDto> {
    const pagina = filtros.pagina ?? 1;
    const limite = filtros.limite ?? POR_PAGINA;
    const conBusqueda: Prisma.UsuarioWhereInput = {
      AND: [DE_COMPRADOR, condicionBusqueda(filtros.buscar)],
    };
    const where: Prisma.UsuarioWhereInput = {
      AND: [
        conBusqueda,
        filtros.rol ? { rol: filtros.rol } : {},
        filtros.activo === undefined ? {} : { activo: filtros.activo },
      ],
    };

    const [filas, total, todos, clientes, profesionales, desactivados] =
      await this.prisma.$transaction([
        this.prisma.usuario.findMany({
          where,
          select: SELECCION_LISTADO,
          orderBy: ORDEN,
          skip: (pagina - 1) * limite,
          take: limite,
        }),
        this.prisma.usuario.count({ where }),
        this.prisma.usuario.count({ where: conBusqueda }),
        this.prisma.usuario.count({
          where: { AND: [conBusqueda, { rol: ROLES.CLIENTE }] },
        }),
        this.prisma.usuario.count({
          where: { AND: [conBusqueda, { rol: ROLES.PROFESIONAL }] },
        }),
        this.prisma.usuario.count({
          where: { AND: [conBusqueda, { activo: false }] },
        }),
      ]);

    return {
      items: filas.map(aClienteListado),
      total,
      pagina,
      limite,
      conteos: { todos, clientes, profesionales, desactivados },
    };
  }

  /**
   * Datos de la cuenta, su perfil profesional, su solicitud de verificación más reciente, cuántos
   * pedidos creó y su historial de rol. Una cuenta del personal responde 404.
   */
  async detalle(codigoPublico: string): Promise<ClienteDetalleDto> {
    const cuenta = await this.prisma.usuario.findFirst({
      where: { codigoPublico, ...DE_COMPRADOR },
      select: {
        ...SELECCION_LISTADO,
        telefono: true,
        aceptaMarketingEmail: true,
        perfilProfesional: {
          select: {
            anosExperiencia: true,
            modalidad: true,
            especialidades: true,
            nombreLugarTrabajo: true,
            redSocial: true,
            comuna: { select: { nombre: true } },
          },
        },
        solicitudesPresentadas: {
          select: { estado: true, fechaSolicitud: true, fechaResolucion: true },
          orderBy: [{ fechaSolicitud: 'desc' }, { id: 'desc' }],
          take: 1,
        },
        cambiosRol: {
          select: {
            rolAnterior: true,
            rolNuevo: true,
            motivo: true,
            fechaCambio: true,
            responsable: { select: { nombre: true, apellido: true } },
          },
          orderBy: [{ fechaCambio: 'desc' }, { id: 'desc' }],
        },
        _count: { select: { pedidos: true } },
      },
    });
    if (!cuenta) throw new NotFoundException(NO_EXISTE_CLIENTE);

    const {
      telefono,
      aceptaMarketingEmail,
      perfilProfesional: perfil,
      solicitudesPresentadas: [solicitud],
      cambiosRol,
      _count,
      ...datos
    } = cuenta;
    return {
      ...aClienteListado(datos),
      telefono,
      aceptaMarketingEmail,
      perfilProfesional: perfil
        ? {
            anosExperiencia: perfil.anosExperiencia,
            modalidad: perfil.modalidad,
            especialidades: perfil.especialidades,
            nombreLugarTrabajo: perfil.nombreLugarTrabajo,
            redSocial: perfil.redSocial,
            comuna: perfil.comuna?.nombre ?? null,
          }
        : null,
      verificacion: solicitud
        ? {
            estado: solicitud.estado as NonNullable<
              ClienteDetalleDto['verificacion']
            >['estado'],
            fechaSolicitud: solicitud.fechaSolicitud,
            fechaResolucion: solicitud.fechaResolucion,
          }
        : null,
      pedidos: _count.pedidos,
      historialRol: cambiosRol.map(
        ({ responsable, rolAnterior, rolNuevo, ...cambio }) => ({
          ...cambio,
          rolAnterior: rolAnterior as Rol,
          rolNuevo: rolNuevo as Rol,
          responsable: `${responsable.nombre} ${responsable.apellido}`,
        }),
      ),
    };
  }

  /**
   * Desactiva la cuenta y cierra todas sus sesiones en una transacción: su token deja de servir y
   * no puede iniciar sesión. Lo demás queda como está. Si ya estaba desactivada, no hace nada.
   */
  async desactivar(
    codigoPublico: string,
    administrador: UsuarioAutenticado,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const id = await this.bloquearComprador(tx, codigoPublico, administrador);
      const { count } = await tx.usuario.updateMany({
        where: { id, activo: true },
        data: { activo: false },
      });
      if (count === 0) return;
      await tx.sesion.updateMany({
        where: { usuarioId: id, fechaRevocacion: null },
        data: { fechaRevocacion: new Date() },
      });
    });
  }

  /**
   * Reactiva la cuenta: vuelve a iniciar sesión con su contraseña de siempre. Las sesiones que se
   * cerraron al desactivarla siguen cerradas. Si ya estaba activa, no hace nada.
   */
  async reactivar(
    codigoPublico: string,
    administrador: UsuarioAutenticado,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const id = await this.bloquearComprador(tx, codigoPublico, administrador);
      await tx.usuario.updateMany({
        where: { id, activo: false },
        data: { activo: true },
      });
    });
  }

  /**
   * Quien pide sigue siendo administrador activo (`FOR SHARE`, como en `PersonalService`: si lo
   * están desactivando o le bajan el rol, espera y responde 403). Luego bloquea la cuenta, que
   * debe ser de cliente o profesional (si no, 404), y devuelve su id.
   */
  private async bloquearComprador(
    tx: Tx,
    codigoPublico: string,
    administrador: UsuarioAutenticado,
  ): Promise<number> {
    const filas = await tx.$queryRaw<{ id: number }[]>`
      SELECT id_usuario AS id FROM usuario
      WHERE codigo_publico = ${administrador.codigoPublico}
        AND rol = ${ROLES.ADMINISTRADOR} AND activo
      FOR SHARE`;
    if (filas.length === 0) throw new ForbiddenException(SIN_ACCESO);

    const id = await bloquearCuenta(tx, codigoPublico, NO_EXISTE_CLIENTE);
    const cuenta = await tx.usuario.findUniqueOrThrow({
      where: { id },
      select: { rol: true },
    });
    if (!ROLES_COMPRADOR.includes(cuenta.rol as Rol)) {
      throw new NotFoundException(NO_EXISTE_CLIENTE);
    }
    return id;
  }
}
