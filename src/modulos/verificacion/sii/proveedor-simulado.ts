import {
  GIRO_PELUQUERIA,
  PROVEEDORES_SII,
} from '../../../common/dominio/valores.js';
import {
  ConsultaSiiNoDisponible,
  ProveedorSituacionTributaria,
  type SituacionTributaria,
} from './proveedor-situacion-tributaria.js';

/** Otro giro cualquiera: «Venta al por menor en comercios no especializados». */
const OTRO_GIRO = {
  codigo: '471100',
  nombre: 'VENTA AL POR MENOR EN COMERCIOS NO ESPECIALIZADOS',
};

/**
 * Proveedor de desarrollo (`SII_PROVEEDOR=simulado`): no consulta a nadie y responde según el
 * último dígito del cuerpo del RUT, para probar cada camino a mano. En producción la app no
 * arranca con él.
 *
 *  - termina en 0: sin actividades (no tiene inicio de actividades)
 *  - termina en 1: solo otro giro
 *  - termina en 2: la consulta falla
 *  - cualquier otro: peluquería (960200) desde el 15 de enero de 2020
 */
export class ProveedorSimulado extends ProveedorSituacionTributaria {
  readonly nombre = PROVEEDORES_SII.SIMULADO;

  consultar(rut: string): Promise<SituacionTributaria> {
    const ultimo = rut.split('-')[0].slice(-1);
    if (ultimo === '2') {
      return Promise.reject(
        new ConsultaSiiNoDisponible('Consulta simulada que falla.'),
      );
    }
    const actividades =
      ultimo === '0'
        ? []
        : ultimo === '1'
          ? [{ ...OTRO_GIRO, fechaInicio: '2019-03-01' }]
          : [
              {
                codigo: GIRO_PELUQUERIA,
                nombre:
                  'ACTIVIDADES DE PELUQUERIA Y OTROS TRATAMIENTOS DE BELLEZA',
                fechaInicio: '2020-01-15',
              },
            ];
    return Promise.resolve({ actividades, operacion: null });
  }
}
