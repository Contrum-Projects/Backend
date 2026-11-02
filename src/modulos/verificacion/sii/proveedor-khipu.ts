import { normalizarRut } from '../../../common/dominio/rut.js';
import { PROVEEDORES_SII } from '../../../common/dominio/valores.js';
import {
  type ActividadSii,
  ConsultaSiiNoDisponible,
  ProveedorSituacionTributaria,
  type SituacionTributaria,
} from './proveedor-situacion-tributaria.js';

/** Si Khipu no responde en este plazo, la consulta se da por no disponible (decisión del 2 nov 2026). */
export const PLAZO_RESPUESTA_KHIPU_MS = 10_000;
export const URL_KHIPU = 'https://api.khipu.com';
const RUTA_SITUACION_TRIBUTARIA = '/v1/cl/services/sii.cl/tax-situation';
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

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
 * Lee la respuesta 200 de Khipu: `{ Status, Data: { TaxSituation: { RolUnicoTributario,
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
    return { actividades: [], operacion };
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
    operacion,
  };
};

/**
 * «Situación tributaria de terceros» del SII, a través de Khipu (E10-H1, decisión del 2 nov 2026).
 * Consulta síncrona: sin `CallbackUrl` la respuesta llega en la misma llamada, y por eso el plazo.
 */
export class ProveedorKhipu extends ProveedorSituacionTributaria {
  readonly nombre = PROVEEDORES_SII.KHIPU;

  constructor(
    private readonly claveApi: string,
    private readonly urlBase: string = URL_KHIPU,
  ) {
    super();
  }

  async consultar(rut: string): Promise<SituacionTributaria> {
    let respuesta: Response;
    try {
      respuesta = await fetch(`${this.urlBase}${RUTA_SITUACION_TRIBUTARIA}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.claveApi,
        },
        body: JSON.stringify({
          RequestData: { RolUnicoTributario: conPuntos(rut) },
        }),
        signal: AbortSignal.timeout(PLAZO_RESPUESTA_KHIPU_MS),
      });
    } catch (error) {
      throw new ConsultaSiiNoDisponible(
        `Khipu no respondió: ${(error as Error).message}`,
      );
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
}

/** Sin clave de Khipu: la app arranca, pero toda consulta falla y se piden documentos. */
export class ProveedorNoConfigurado extends ProveedorSituacionTributaria {
  readonly nombre = PROVEEDORES_SII.KHIPU;

  consultar(): Promise<SituacionTributaria> {
    return Promise.reject(
      new ConsultaSiiNoDisponible(
        'Khipu sin configurar (falta KHIPU_API_KEY).',
      ),
    );
  }
}
