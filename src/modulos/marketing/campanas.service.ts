import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import {
  COLAS,
  TRABAJOS_CORREO,
  type TrabajoCampana,
} from '../../colas/colas.js';
import { encolarCorreos } from '../../colas/encolar-correo.js';
import {
  ESTADOS_NOTIFICACION,
  TIPOS_CAMPANA,
  TIPOS_DESTINATARIO_CAMPANA,
  TIPOS_NOTIFICACION,
} from '../../common/dominio/valores.js';
import { porcentaje } from '../../common/dominio/porcentajes.js';
import { POR_PAGINA } from '../../common/validacion/paginacion.js';
import type { Paginacion } from '../../common/validacion/paginacion.js';
import type { Entorno } from '../../config/entorno.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { correoCampana } from '../notificaciones/plantillas/campana.js';
import { rutasTienda } from '../notificaciones/plantillas/base.js';
import { buscarDestinatarios } from './destinatarios-campana.js';
import type { ActualizarCampanaDto } from './dto/actualizar-campana.dto.js';
import type { CrearCampanaDto } from './dto/crear-campana.dto.js';
import type { SegmentoCampanaDto } from './dto/segmento-campana.dto.js';
import { aplicarMarcadores } from './marcadores-campana.js';
import { HuellaCampana } from './huella-campana.js';
import {
  conSubcategorias,
  type Destinatarios,
  filtraPorCompras,
  filtraPorCuenta,
  incluyeSuscriptores,
  leerSegmento,
  normalizarSegmento,
  type SegmentoCampana,
  textoSegmento,
  totalDestinatarios,
} from './segmento-campana.js';
import { errorDeCampo } from '../../common/errores/error-de-campo.js';

const NO_EXISTE = 'La campaña no existe.';
const YA_ENVIADA = 'La campaña ya fue enviada: cada campaña sale una sola vez.';
const VISTA_PREVIA_VIEJA =
  'La campaña cambió después de la vista previa. Pide otra vista previa antes de enviarla.';
const VISTA_PREVIA_VENCIDA =
  'La vista previa tiene más de una hora. Pide otra vista previa antes de enviarla.';
const SIN_DESTINATARIOS =
  'El segmento no tiene destinatarios que acepten publicidad.';

/** Trabajos por operación al encolar: una campaña grande no arma una sola llamada enorme a Redis. */
const LOTE_ENCOLAR = 500;
/** Mínimo y máximo de un mismo filtro: el mínimo no puede pasar al máximo (SCRUM-150). */
const RANGOS_SEGMENTO = [
  [
    'pedidosMinimo',
    'pedidosMaximo',
    'pedidosMaximo',
    'El máximo de pedidos no puede ser menor que el mínimo.',
  ],
  [
    'gastoMinimo',
    'gastoMaximo',
    'gastoMaximo',
    'El gasto máximo no puede ser menor que el mínimo.',
  ],
  [
    'edadMinima',
    'edadMaxima',
    'edadMaxima',
    'La edad máxima no puede ser menor que la mínima.',
  ],
] as const satisfies readonly [
  keyof SegmentoCampana,
  keyof SegmentoCampana,
  string,
  string,
][];

/** Crear las NOTIFICACION de una campaña grande puede pasar del plazo por omisión de Prisma (5 s). */
const PLAZO_TRANSACCION_MS = 30_000;

const SELECCION = {
  id: true,
  asunto: true,
  cuerpo: true,
  segmento: true,
  fechaCreacion: true,
  fechaEncolado: true,
  usuario: { select: { nombre: true, apellido: true } },
} as const;

type FilaCampana = Prisma.CampanaGetPayload<{ select: typeof SELECCION }>;

export interface EnviosCampana {
  total: number;
  pendientes: number;
  enviados: number;
  fallidos: number;
  cancelados: number;
  /** E12-H6: el servidor de destino los rechazó. */
  rebotados: number;
}

export interface CampanaPanel {
  id: number;
  asunto: string;
  cuerpo: string;
  segmento: SegmentoCampana;
  enviada: boolean;
  fechaCreacion: Date;
  /** Cuándo se confirmó el envío (`campana.fecha_encolado`). */
  fechaEnvio: Date | null;
  creadaPor: { nombre: string; apellido: string };
}

export interface DetalleCampana extends CampanaPanel {
  envios: EnviosCampana;
}

/**
 * Contactos con consentimiento, para los contadores de «Campañas» (SCRUM-150). Se cuentan con las
 * mismas reglas que el envío: cada dirección una vez y, si una cuenta y un suscriptor comparten
 * correo, decide la cuenta.
 */
export interface ContactosCampanas {
  /** Direcciones que recibirían hoy una campaña a todos: cuentas y suscriptores sin cuenta. */
  aceptanPublicidad: number;
  /** Cuentas cliente o profesional activas, con el correo verificado, que aceptan publicidad. */
  cuentasVerificadas: number;
  /** Suscriptores confirmados, sin baja y sin una cuenta con el mismo correo. */
  suscriptoresSinCuenta: number;
  /** Direcciones (de cuentas o suscriptores) con algún correo rebotado (E12-H6). */
  conRebote: number;
}

/** Una fila del listado, con sus cifras (SCRUM-150). */
export interface CampanaListada extends CampanaPanel {
  /** Borrador: cuántas direcciones la recibirían hoy. Enviada: a cuántas salió. */
  destinatarios: number;
  /** Enviada: de los correos enviados, cuántos se abrieron (0 a 100). Borrador o sin envíos: `null`. */
  porcentajeApertura: number | null;
}

export interface ListadoCampanas {
  contactos: ContactosCampanas;
  items: CampanaListada[];
  total: number;
  pagina: number;
  limite: number;
}

/** El correo de una campaña tal como saldría (asunto, HTML y texto plano). */
export interface CorreoCampana {
  asunto: string;
  html: string;
  texto: string;
}

export interface VistaPreviaCampana extends CorreoCampana {
  /** Direcciones que lo recibirían hoy (cada una una vez). */
  destinatarios: number;
  /** Se entrega al confirmar el envío (`POST /:id/envio`). */
  confirmacion: string;
}

export interface CampanaEnviada {
  id: number;
  fechaEnvio: Date;
  destinatarios: number;
}

/**
 * Campañas de correo de envío único (E12-H3, RF-12.05 a RF-12.08). Se redactan como borrador, se
 * piden en vista previa y se envían con su confirmación. El envío es una sola vez (CA2): marca la
 * campaña y crea una NOTIFICACION por dirección en la misma transacción (RNF-12), y encola después
 * del commit; si Redis no responde, la revisión de pendientes las reencola (RNF-29, RNF-32).
 */
@Injectable()
export class CampanasService {
  private readonly logger = new Logger(CampanasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Entorno, true>,
    private readonly huella: HuellaCampana,
    @InjectQueue(COLAS.CORREOS) private readonly correos: Queue,
  ) {}

  async crear(
    dto: CrearCampanaDto,
    codigoAutor: string,
  ): Promise<DetalleCampana> {
    const segmento = await this.validarSegmento(dto.segmento);
    const autor = await this.prisma.usuario.findUnique({
      where: { codigoPublico: codigoAutor },
      select: { id: true },
    });
    if (!autor) throw new NotFoundException('La cuenta no existe.');
    const fila = await this.prisma.campana.create({
      data: {
        usuarioId: autor.id,
        tipo: TIPOS_CAMPANA.ENVIO_UNICO,
        asunto: dto.asunto,
        cuerpo: dto.cuerpo,
        segmento: textoSegmento(segmento),
      },
      select: SELECCION,
    });
    return { ...this.aRespuesta(fila), envios: SIN_ENVIOS };
  }

  /** Campañas de envío único, de la más nueva a la más antigua. */
  async listar(paginacion: Paginacion): Promise<ListadoCampanas> {
    const pagina = paginacion.pagina ?? 1;
    const limite = paginacion.limite ?? POR_PAGINA;
    const donde = { tipo: TIPOS_CAMPANA.ENVIO_UNICO };
    const [filas, total] = await this.prisma.$transaction([
      this.prisma.campana.findMany({
        where: donde,
        select: SELECCION,
        orderBy: [{ fechaCreacion: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * limite,
        take: limite,
      }),
      this.prisma.campana.count({ where: donde }),
    ]);
    const enviadas = filas
      .filter((fila) => fila.fechaEncolado !== null)
      .map((fila) => fila.id);
    const [contactos, envios, items] = await Promise.all([
      this.contactos(),
      this.enviosDe(enviadas),
      filas.map((fila) => this.aRespuesta(fila)),
    ]);
    return {
      contactos,
      items: await Promise.all(
        items.map(async (campana) => {
          if (!campana.enviada) {
            return {
              ...campana,
              destinatarios: totalDestinatarios(
                await this.destinatarios(this.prisma, campana.segmento),
              ),
              porcentajeApertura: null,
            };
          }
          const conteo = envios.get(campana.id);
          return {
            ...campana,
            destinatarios: conteo?.total ?? 0,
            porcentajeApertura: porcentaje(
              conteo?.abiertos ?? 0,
              conteo?.enviados ?? 0,
            ),
          };
        }),
      ),
      total,
      pagina,
      limite,
    };
  }

  /** SCRUM-150 · Los contadores de «Campañas», con las reglas del envío. */
  private async contactos(): Promise<ContactosCampanas> {
    const [{ cuentas, suscriptores }, [rebotes]] = await Promise.all([
      this.destinatarios(
        this.prisma,
        normalizarSegmento({
          tipos: Object.values(TIPOS_DESTINATARIO_CAMPANA),
        }),
      ),
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(DISTINCT COALESCE('u' || id_usuario::text, 'l' || id_lead::text)) AS "total"
        FROM notificacion
        WHERE estado_envio = ${ESTADOS_NOTIFICACION.REBOTADA}
          AND (id_usuario IS NOT NULL OR id_lead IS NOT NULL)`,
    ]);
    return {
      aceptanPublicidad: cuentas.length + suscriptores.length,
      cuentasVerificadas: cuentas.length,
      suscriptoresSinCuenta: suscriptores.length,
      conRebote: Number(rebotes?.total ?? 0n),
    };
  }

  /** Correos de las campañas enviadas de la página: todos, los enviados y los abiertos de estos. */
  private async enviosDe(
    ids: number[],
  ): Promise<
    Map<number, { total: number; enviados: number; abiertos: number }>
  > {
    if (ids.length === 0) return new Map();
    const filas = await this.prisma.$queryRaw<
      { id: number; total: bigint; enviados: bigint; abiertos: bigint }[]
    >`
      SELECT id_campana AS "id",
             COUNT(*) AS "total",
             COUNT(*) FILTER (WHERE estado_envio = ${ESTADOS_NOTIFICACION.ENVIADA}) AS "enviados",
             COUNT(*) FILTER (WHERE estado_envio = ${ESTADOS_NOTIFICACION.ENVIADA} AND fecha_apertura IS NOT NULL) AS "abiertos"
      FROM notificacion
      WHERE id_campana = ANY(${ids}::int[])
      GROUP BY id_campana`;
    return new Map(
      filas.map((fila) => [
        fila.id,
        {
          total: Number(fila.total),
          enviados: Number(fila.enviados),
          abiertos: Number(fila.abiertos),
        },
      ]),
    );
  }

  async obtener(id: number): Promise<DetalleCampana> {
    const fila = await this.buscar(id);
    const conteo = await this.prisma.notificacion.groupBy({
      by: ['estadoEnvio'],
      where: { campanaId: id },
      _count: { _all: true },
    });
    const de = (estado: string) =>
      conteo.find((grupo) => grupo.estadoEnvio === estado)?._count._all ?? 0;
    const envios: EnviosCampana = {
      total: conteo.reduce((suma, grupo) => suma + grupo._count._all, 0),
      pendientes: de(ESTADOS_NOTIFICACION.PENDIENTE),
      enviados: de(ESTADOS_NOTIFICACION.ENVIADA),
      fallidos: de(ESTADOS_NOTIFICACION.FALLIDA),
      cancelados: de(ESTADOS_NOTIFICACION.CANCELADA),
      rebotados: de(ESTADOS_NOTIFICACION.REBOTADA),
    };
    return { ...this.aRespuesta(fila), envios };
  }

  /** Solo un borrador: una campaña enviada queda como salió (CA2). */
  async actualizar(
    id: number,
    dto: ActualizarCampanaDto,
  ): Promise<DetalleCampana> {
    if (
      dto.asunto === undefined &&
      dto.cuerpo === undefined &&
      dto.segmento === undefined
    ) {
      throw new BadRequestException('Indica al menos un campo para cambiar.');
    }
    const segmento = dto.segmento
      ? textoSegmento(await this.validarSegmento(dto.segmento))
      : undefined;
    // Con la condición en el mismo UPDATE: un envío simultáneo no deja editar lo que ya salió
    const { count } = await this.prisma.campana.updateMany({
      where: { id, tipo: TIPOS_CAMPANA.ENVIO_UNICO, fechaEncolado: null },
      data: { asunto: dto.asunto, cuerpo: dto.cuerpo, segmento },
    });
    if (count === 0) {
      const fila = await this.buscar(id);
      if (fila.fechaEncolado) throw new ConflictException(YA_ENVIADA);
    }
    return this.obtener(id);
  }

  /**
   * E12-H3 · El correo tal como saldrá, cuántas direcciones lo recibirían hoy y la confirmación
   * que exige el envío. El enlace de baja de la vista previa lleva a la pantalla de baja sin token:
   * así no da de baja a nadie.
   */
  async vistaPrevia(
    id: number,
    codigoUsuario: string,
  ): Promise<VistaPreviaCampana> {
    const fila = await this.buscar(id);
    if (fila.fechaEncolado) throw new ConflictException(YA_ENVIADA);
    const segmento = leerSegmento(fila.segmento);
    const destinatarios = await this.destinatarios(this.prisma, segmento);
    return {
      ...(await this.renderizar(fila, codigoUsuario)),
      destinatarios: totalDestinatarios(destinatarios),
      confirmacion: this.huella.calcular({
        id,
        asunto: fila.asunto,
        cuerpo: fila.cuerpo,
        segmento: textoSegmento(segmento),
      }),
    };
  }

  /**
   * SCRUM-150 · Vista previa en vivo, mientras se redacta: solo arma el correo con la misma
   * plantilla. No lee ni guarda la campaña, no cuenta destinatarios y **nunca** devuelve la
   * confirmación: para enviar hay que guardar el borrador y pedir `vistaPrevia(id)`. Los
   * marcadores se completan con los datos de quien mira la vista previa: así se ve cómo le
   * llegará a cada cuenta.
   */
  async renderizar(
    {
      asunto,
      cuerpo,
    }: {
      asunto: string;
      cuerpo: string;
    },
    codigoUsuario: string,
  ): Promise<CorreoCampana> {
    const urlTienda = this.config
      .get('URL_TIENDA', { infer: true })
      .replace(/\/+$/, '');
    const cuenta = await this.prisma.usuario.findUnique({
      where: { codigoPublico: codigoUsuario },
      select: { nombre: true, apellido: true },
    });
    const datos = {
      nombre: cuenta?.nombre ?? null,
      apellido: cuenta?.apellido ?? null,
      urlTienda,
    };
    const asuntoFinal = aplicarMarcadores(asunto, datos);
    const { html, texto } = correoCampana({
      asunto: asuntoFinal,
      cuerpo: aplicarMarcadores(cuerpo, datos),
      enlaceBaja: `${urlTienda}/ofertas/baja`,
      enlacesPie: rutasTienda(urlTienda).pie,
    });
    return { asunto: asuntoFinal, html, texto };
  }

  /**
   * E12-H3 · CA1 a CA3. Con la campaña bloqueada: dos confirmaciones simultáneas no la envían dos
   * veces y una edición que esperaba el bloqueo ya no la cambia. Los destinatarios se calculan
   * dentro de la transacción, y al enviar cada correo se revisa otra vez el consentimiento (E12-H2).
   */
  async enviar(id: number, confirmacion: string): Promise<CampanaEnviada> {
    const resultado = await this.prisma.$transaction(
      async (tx) => {
        const [fila] = await tx.$queryRaw<
          {
            asunto: string;
            cuerpo: string;
            segmento: string | null;
            fechaEncolado: Date | null;
          }[]
        >`
          SELECT asunto, cuerpo, segmento, fecha_encolado AS "fechaEncolado"
          FROM campana
          WHERE id_campana = ${id} AND tipo = ${TIPOS_CAMPANA.ENVIO_UNICO}
          FOR UPDATE`;
        if (!fila) throw new NotFoundException(NO_EXISTE);
        if (fila.fechaEncolado) throw new ConflictException(YA_ENVIADA);

        const segmento = leerSegmento(fila.segmento);
        const segmentoUsado = textoSegmento(segmento);
        const contenido = {
          id,
          asunto: fila.asunto,
          cuerpo: fila.cuerpo,
          segmento: segmentoUsado,
        };
        const huella = this.huella.verificar(contenido, confirmacion);
        if (huella === 'vencida') {
          throw new ConflictException(VISTA_PREVIA_VENCIDA);
        }
        if (huella === 'invalida') {
          throw new ConflictException(VISTA_PREVIA_VIEJA);
        }

        const destinatarios = await this.destinatarios(tx, segmento);
        if (totalDestinatarios(destinatarios) === 0) {
          throw new ConflictException(SIN_DESTINATARIOS);
        }
        const ahora = new Date();
        // CA1: guarda el segmento usado y marca la campaña como enviada
        await tx.campana.update({
          where: { id },
          data: { fechaEncolado: ahora, segmento: segmentoUsado },
        });
        const correos = await this.registrarNotificaciones(
          tx,
          id,
          fila.asunto,
          destinatarios,
        );
        return { fechaEnvio: ahora, correos };
      },
      { timeout: PLAZO_TRANSACCION_MS },
    );

    // Después del commit; sin Redis la petición no falla (RNF-32)
    for (let i = 0; i < resultado.correos.length; i += LOTE_ENCOLAR) {
      await encolarCorreos(
        this.correos,
        TRABAJOS_CORREO.CAMPANA,
        resultado.correos.slice(i, i + LOTE_ENCOLAR),
        this.logger,
      );
    }
    return {
      id,
      fechaEnvio: resultado.fechaEnvio,
      destinatarios: resultado.correos.length,
    };
  }

  /** Una NOTIFICACION `campana` por dirección, con la cuenta o el suscriptor al que va. */
  private async registrarNotificaciones(
    tx: Prisma.TransactionClient,
    campanaId: number,
    asunto: string,
    { cuentas, suscriptores }: Destinatarios,
  ): Promise<TrabajoCampana[]> {
    const base = {
      campanaId,
      tipo: TIPOS_NOTIFICACION.CAMPANA,
      asunto,
      estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
    };
    const filas = await tx.notificacion.createManyAndReturn({
      data: [
        ...cuentas.map((cuenta) => ({ ...base, usuarioId: cuenta.id })),
        ...suscriptores.map((lead) => ({ ...base, leadId: lead.id })),
      ],
      select: { id: true, usuarioId: true, leadId: true },
    });
    const correoCuenta = new Map(cuentas.map((c) => [c.id, c.email]));
    const correoLead = new Map(suscriptores.map((l) => [l.id, l.email]));
    return filas.map((fila) => ({
      notificacionId: fila.id,
      destinatario:
        (fila.usuarioId !== null
          ? correoCuenta.get(fila.usuarioId)
          : correoLead.get(fila.leadId ?? -1)) ?? '',
    }));
  }

  private async destinatarios(
    cliente: Prisma.TransactionClient,
    segmento: SegmentoCampana,
  ): Promise<Destinatarios> {
    const categorias =
      segmento.categorias.length === 0
        ? []
        : conSubcategorias(
            segmento.categorias,
            await cliente.categoria.findMany({
              select: { id: true, padreId: true },
            }),
          );
    return buscarDestinatarios(cliente, segmento, categorias);
  }

  /** Reglas del segmento que necesitan la base o miran varios campos a la vez. */
  private async validarSegmento(
    dto: SegmentoCampanaDto,
  ): Promise<SegmentoCampana> {
    const segmento = normalizarSegmento(dto);
    if (filtraPorCompras(segmento) && incluyeSuscriptores(segmento)) {
      throw errorDeCampo(
        BadRequestException,
        'Los suscriptores sin cuenta no tienen compras: quítalos del segmento o quita las categorías y marcas.',
        'segmento.tipos',
      );
    }
    if (filtraPorCuenta(segmento) && incluyeSuscriptores(segmento)) {
      throw errorDeCampo(
        BadRequestException,
        'Los suscriptores sin cuenta no tienen compras, dirección ni datos de perfil: quítalos del segmento o quita esos filtros.',
        'segmento.tipos',
      );
    }
    for (const [minimo, maximo, campo, texto] of RANGOS_SEGMENTO) {
      const desde = segmento[minimo];
      const hasta = segmento[maximo];
      if (desde !== null && hasta !== null && desde > hasta) {
        throw errorDeCampo(BadRequestException, texto, `segmento.${campo}`);
      }
    }
    const [categorias, marcas, regiones, comunas] = await Promise.all([
      this.prisma.categoria.count({
        where: { id: { in: segmento.categorias } },
      }),
      this.prisma.marca.count({ where: { id: { in: segmento.marcas } } }),
      segmento.regiones.length === 0
        ? 0
        : this.prisma.region.count({
            where: { id: { in: segmento.regiones } },
          }),
      segmento.comunas.length === 0
        ? 0
        : this.prisma.comuna.count({
            where: { id: { in: segmento.comunas } },
          }),
    ]);
    if (regiones !== segmento.regiones.length) {
      throw errorDeCampo(
        BadRequestException,
        'Alguna región indicada no existe.',
        'segmento.regiones',
      );
    }
    if (comunas !== segmento.comunas.length) {
      throw errorDeCampo(
        BadRequestException,
        'Alguna comuna indicada no existe.',
        'segmento.comunas',
      );
    }
    if (categorias !== segmento.categorias.length) {
      throw errorDeCampo(
        BadRequestException,
        'Alguna categoría indicada no existe.',
        'segmento.categorias',
      );
    }
    if (marcas !== segmento.marcas.length) {
      throw errorDeCampo(
        BadRequestException,
        'Alguna marca indicada no existe.',
        'segmento.marcas',
      );
    }
    return segmento;
  }

  private async buscar(id: number): Promise<FilaCampana> {
    const fila = await this.prisma.campana.findFirst({
      where: { id, tipo: TIPOS_CAMPANA.ENVIO_UNICO },
      select: SELECCION,
    });
    if (!fila) throw new NotFoundException(NO_EXISTE);
    return fila;
  }

  private aRespuesta(fila: FilaCampana): CampanaPanel {
    return {
      id: fila.id,
      asunto: fila.asunto,
      cuerpo: fila.cuerpo,
      segmento: leerSegmento(fila.segmento),
      enviada: fila.fechaEncolado !== null,
      fechaCreacion: fila.fechaCreacion,
      fechaEnvio: fila.fechaEncolado,
      creadaPor: fila.usuario,
    };
  }
}

const SIN_ENVIOS: EnviosCampana = {
  total: 0,
  pendientes: 0,
  enviados: 0,
  fallidos: 0,
  cancelados: 0,
  rebotados: 0,
};
