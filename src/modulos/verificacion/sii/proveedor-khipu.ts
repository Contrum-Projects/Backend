import { normalizarRut } from '../../../common/dominio/rut.js';
import { PROVEEDORES_SII } from '../../../common/dominio/valores.js';
import {
  type ActividadSii,
  ConsultaSiiNoDisponible,
  ProveedorSituacionTributaria,
  type SituacionTributaria,
} from './proveedor-situacion-tributaria.js';

/**
 * Si Khipu no responde en este plazo, la consulta se da por no disponible (decisión del 2 nov 2026).
 * Cubre también pedir el token cuando no hay uno guardado.
 */
export const PLAZO_RESPUESTA_KHIPU_MS = 10_000;
export const URL_KHIPU = 'https://api.khipu.com';
export const URL_AUTH_KHIPU = 'https://auth-server.khipu.com';
const RUTA_SITUACION_TRIBUTARIA = '/v1/cl/services/sii.cl/tax-situation';
const RUTA_TOKEN = '/oauth2/token';
/** El token dura un año y Khipu no da `refresh_token`: se pide otro un día antes de que venza. */
const MARGEN_RENOVACION_MS = 24 * 60 * 60_000;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** «Id de cobrador» y «Llave» de la cuenta de Khipu: el cliente OAuth con que se pide el token. */
export interface CredencialesKhipu {
  idCliente: string;
  secreto: string;
}

interface TokenKhipu {
  valor: string;
  /** Momento (ms) desde el que ya no se usa y se pide otro. */
  renovarDesde: number;
}

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor);

/** `12345678-K` como lo escribe Khipu en su ejemplo: `12.345.678-K`. */
const conPuntos = (rut: string) => {
  const [cuerpo, digito] = rut.split('-');
  return `${cuerpo.replace(/\B(?=(\d{3})+$)/g, '.')}-${digito}`;
};

const aActividad = (valor: unknown): ActividadSii | null => {
  if (!esObjeto(valor) || typeof valor.Code !== 'string') return null;
  const codigo = valor.Code.trim();
  if (codigo === '') return null;
  return {
    codigo,
    nombre: typeof valor.Activity === 'string' ? valor.Activity.trim() : '',
    fechaInicio:
      typeof valor.Date === 'string' && FECHA.test(valor.Date)
        ? valor.Date
        : null,
  };
};

/**
 * Lee la respuesta 200 de Khipu: `{ Status, Data: { TaxSituation: { RolUnicoTributario, Name,
 * Activities: [{ Activity, Code, Category, AffectsIVA, Date }] } }, Error, OperationId }`.
 * `Data` nulo o sin actividades es un RUT sin actividades; una forma que no se espera, no.
 */
const interpretar = (cuerpo: unknown, rut: string): SituacionTributaria => {
  if (!esObjeto(cuerpo)) {
    throw new ConsultaSiiNoDisponible('Khipu devolvió algo que no es JSON.');
  }
  if (cuerpo.Status !== 'OK') {
    const error = esObjeto(cuerpo.Error) ? cuerpo.Error : {};
    const codigo = typeof error.Code === 'string' ? error.Code : 'sin código';
    const tipo = typeof error.Type === 'string' ? error.Type : 'sin tipo';
    throw new ConsultaSiiNoDisponible(
      `Khipu informó un error (${codigo}, ${tipo}).`,
    );
  }
  const operacion =
    typeof cuerpo.OperationId === 'string' ? cuerpo.OperationId : null;
  const situacion = esObjeto(cuerpo.Data) ? cuerpo.Data.TaxSituation : null;
  if (situacion === null || situacion === undefined) {
    return { actividades: [], contribuyente: null, operacion };
  }
  if (!esObjeto(situacion)) {
    throw new ConsultaSiiNoDisponible('Khipu devolvió una situación ilegible.');
  }
  // Nunca decidir por la situación de otro contribuyente
  if (
    typeof situacion.RolUnicoTributario === 'string' &&
    normalizarRut(situacion.RolUnicoTributario) !== rut
  ) {
    throw new ConsultaSiiNoDisponible('Khipu respondió por otro RUT.');
  }
  const crudas = situacion.Activities ?? [];
  if (!Array.isArray(crudas)) {
    throw new ConsultaSiiNoDisponible('Khipu devolvió actividades ilegibles.');
  }
  return {
    actividades: crudas
      .map(aActividad)
      .filter((actividad) => actividad !== null),
    contribuyente:
      typeof situacion.Name === 'string' && situacion.Name.trim() !== ''
        ? situacion.Name.trim()
        : null,
    operacion,
  };
};

/** Lee la respuesta del servidor de autorización: `{ access_token, token_type, expires_in, scope }`. */
const leerToken = (cuerpo: unknown, ahora: number): TokenKhipu => {
  if (
    !esObjeto(cuerpo) ||
    typeof cuerpo.access_token !== 'string' ||
    cuerpo.access_token.trim() === ''
  ) {
    throw new ConsultaSiiNoDisponible('Khipu no entregó un token legible.');
  }
  const vidaMs =
    typeof cuerpo.expires_in === 'number' && cuerpo.expires_in > 0
      ? cuerpo.expires_in * 1000
      : 0;
  // Sin vencimiento informado se usa solo para esta consulta
  const margen = Math.min(MARGEN_RENOVACION_MS, vidaMs / 10);
  return {
    valor: cuerpo.access_token.trim(),
    renovarDesde: ahora + vidaMs - margen,
  };
};

/**
 * «Situación tributaria de terceros» del SII, a través de Khipu (E10-H1, decisión del 2 nov 2026).
 * Consulta síncrona: sin `CallbackUrl` la respuesta llega en la misma llamada, y por eso el plazo.
 *
 * Se autentica con `Authorization: Bearer <JWT>`; Khipu retira el `x-api-key`. El token se pide
 * con `client_credentials` al servidor de autorización, se guarda en memoria hasta poco antes de
 * que venza y, si Khipu lo rechaza (401), se pide otro una vez.
 */
export class ProveedorKhipu extends ProveedorSituacionTributaria {
  readonly nombre = PROVEEDORES_SII.KHIPU;
  private token: TokenKhipu | null = null;
  /** Pedido de token en curso: las consultas simultáneas lo comparten en vez de pedir uno cada una. */
  private pidiendoToken: Promise<string> | null = null;

  constructor(
    private readonly credenciales: CredencialesKhipu,
    private readonly urlBase: string = URL_KHIPU,
    private readonly urlAuth: string = URL_AUTH_KHIPU,
  ) {
    super();
  }

  async consultar(rut: string): Promise<SituacionTributaria> {
    const plazo = AbortSignal.timeout(PLAZO_RESPUESTA_KHIPU_MS);
    const guardado = this.tokenVigente();
    let respuesta = await this.pedirSituacion(
      rut,
      guardado ?? (await this.obtenerToken(plazo)),
      plazo,
    );
    // Un token guardado puede haber sido revocado: se descarta y se intenta una vez con uno nuevo
    if (respuesta.status === 401 && guardado !== null) {
      this.descartarToken(guardado);
      respuesta = await this.pedirSituacion(
        rut,
        await this.obtenerToken(plazo),
        plazo,
      );
    }
    if (respuesta.status === 401) {
      this.descartarToken(this.token?.valor ?? null);
    }
    // 202 es la respuesta asíncrona (con `CallbackUrl`), que acá no se usa: sin datos, no hay consulta
    if (respuesta.status !== 200) {
      throw new ConsultaSiiNoDisponible(`Khipu respondió ${respuesta.status}.`);
    }
    let cuerpo: unknown;
    try {
      cuerpo = await respuesta.json();
    } catch {
      throw new ConsultaSiiNoDisponible('Khipu devolvió algo que no es JSON.');
    }
    return interpretar(cuerpo, rut);
  }

  private tokenVigente(): string | null {
    if (this.token === null || Date.now() >= this.token.renovarDesde) {
      return null;
    }
    return this.token.valor;
  }

  /** Solo descarta el token rechazado: otra consulta pudo haber guardado uno nuevo entretanto. */
  private descartarToken(valor: string | null) {
    if (valor !== null && this.token?.valor === valor) this.token = null;
  }

  private obtenerToken(plazo: AbortSignal): Promise<string> {
    this.pidiendoToken ??= this.pedirToken(plazo).finally(() => {
      this.pidiendoToken = null;
    });
    return this.pidiendoToken;
  }

  private async pedirToken(plazo: AbortSignal): Promise<string> {
    const { idCliente, secreto } = this.credenciales;
    let respuesta: Response;
    try {
      respuesta = await fetch(`${this.urlAuth}${RUTA_TOKEN}`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${idCliente}:${secreto}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
        signal: plazo,
      });
    } catch (error) {
      throw new ConsultaSiiNoDisponible(
        `Khipu no entregó el token: ${(error as Error).message}`,
      );
    }
    if (respuesta.status !== 200) {
      throw new ConsultaSiiNoDisponible(
        `Khipu rechazó el pedido de token (${respuesta.status}).`,
      );
    }
    let cuerpo: unknown;
    try {
      cuerpo = await respuesta.json();
    } catch {
      throw new ConsultaSiiNoDisponible('Khipu no entregó un token legible.');
    }
    const token = leerToken(cuerpo, Date.now());
    this.token = token;
    return token.valor;
  }

  private async pedirSituacion(
    rut: string,
    token: string,
    plazo: AbortSignal,
  ): Promise<Response> {
    try {
      return await fetch(`${this.urlBase}${RUTA_SITUACION_TRIBUTARIA}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          RequestData: { RolUnicoTributario: conPuntos(rut) },
        }),
        signal: plazo,
      });
    } catch (error) {
      throw new ConsultaSiiNoDisponible(
        `Khipu no respondió: ${(error as Error).message}`,
      );
    }
  }
}

/** Sin credenciales de Khipu: la app arranca, pero toda consulta falla y se piden documentos. */
export class ProveedorNoConfigurado extends ProveedorSituacionTributaria {
  readonly nombre = PROVEEDORES_SII.KHIPU;

  consultar(): Promise<SituacionTributaria> {
    return Promise.reject(
      new ConsultaSiiNoDisponible(
        'Khipu sin configurar (faltan KHIPU_CLIENT_ID y KHIPU_CLIENT_SECRET).',
      ),
    );
  }
}
