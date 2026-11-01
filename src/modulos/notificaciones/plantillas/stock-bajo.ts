import {
  aviso,
  boton,
  cajaDatos,
  type CorreoRenderizado,
  type FilaDato,
  marco,
  texto,
  textoPlano,
  titulo,
} from './base.js';

const TITULO = 'Stock bajo el mínimo';
const ACCION = 'Ver en inventario';
const PIE = 'Aviso automático para el personal de bodega y administración.';

export interface DatosStockBajo {
  asunto: string;
  /** `Shampoo reparador · 300 ml` */
  formato: string;
  stockTotal: number;
  stockMinimo: number;
  filas: FilaDato[];
  urlInventario: string;
}

const unidades = (cantidad: number): string =>
  cantidad === 1 ? 'Queda 1 unidad' : `Quedan ${cantidad} unidades`;

export const correoStockBajo = (datos: DatosStockBajo): CorreoRenderizado => {
  const situacion = `${unidades(datos.stockTotal)} en total. El mínimo es ${datos.stockMinimo}.`;
  return {
    html: marco({
      asunto: datos.asunto,
      panel: true,
      cuerpo: [
        titulo(TITULO),
        aviso(datos.formato, situacion),
        cajaDatos(datos.filas),
        boton(ACCION, datos.urlInventario),
      ].join(''),
      pie: PIE,
    }),
    texto: textoPlano(
      TITULO,
      `${datos.formato}: ${situacion}`,
      datos.filas.map((f) => `${f.etiqueta}: ${f.valor}`).join('\n'),
      `${ACCION}: ${datos.urlInventario}`,
      PIE,
    ),
  };
};

/**
 * Aviso que se perdió de Redis: NOTIFICACION no guarda el formato (RNF-29, sin cambios al MER), así
 * que solo se repite el asunto, que lo nombra, y se remite al panel para ver las cifras al día.
 */
export const correoStockBajoRecuperado = (datos: {
  asunto: string;
  urlInventario: string;
}): CorreoRenderizado => {
  const mensaje = `${datos.asunto}. Revisa el inventario para ver el stock actual.`;
  return {
    html: marco({
      asunto: datos.asunto,
      panel: true,
      cuerpo: [
        titulo(TITULO),
        texto(mensaje),
        boton(ACCION, datos.urlInventario),
      ].join(''),
      pie: PIE,
    }),
    texto: textoPlano(
      TITULO,
      mensaje,
      `${ACCION}: ${datos.urlInventario}`,
      PIE,
    ),
  };
};
