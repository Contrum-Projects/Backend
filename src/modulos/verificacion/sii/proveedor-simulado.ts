import type { PrismaService } from '../../../prisma/prisma.service.js';
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

/** Un contribuyente que no es quien solicita. */
const CONTRIBUYENTE_AJENO = 'ROJAS DIAZ PEDRO ANTONIO';

/**
 * Proveedor de desarrollo (`SII_PROVEEDOR=simulado`): no consulta a nadie y responde según el
 * último dígito del cuerpo del RUT, para probar cada camino a mano. En producción la app no
 * arranca con él.
 *
 *  - termina en 0: sin actividades (no tiene inicio de actividades)
 *  - termina en 1: solo otro giro
 *  - termina en 2: la consulta falla
 *  - termina en 3: peluquería, pero a nombre de otra persona (SCRUM-163)
 *  - cualquier otro: peluquería (960200) desde el 15 de enero de 2020
 *
 * El contribuyente es la cuenta que tiene ese RUT, escrita como el SII («APELLIDO NOMBRE»), para
 * que el nombre calce y se pueda probar la aprobación automática.
 */
export class ProveedorSimulado extends ProveedorSituacionTributaria {
  readonly nombre = PROVEEDORES_SII.SIMULADO;

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async consultar(rut: string): Promise<SituacionTributaria> {
    const ultimo = rut.split('-')[0].slice(-1);
    if (ultimo === '2') {
      throw new ConsultaSiiNoDisponible('Consulta simulada que falla.');
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
    return {
      actividades,
      contribuyente:
        ultimo === '3' ? CONTRIBUYENTE_AJENO : await this.titular(rut),
      operacion: null,
    };
  }

  private async titular(rut: string): Promise<string | null> {
    const cuenta = await this.prisma.usuario.findUnique({
      where: { rut },
      select: { nombre: true, apellido: true },
    });
    return cuenta ? `${cuenta.apellido} ${cuenta.nombre}`.toUpperCase() : null;
  }
}
