import {
  boton,
  cajaDatos,
  type CorreoRenderizado,
  type EnlacesPie,
  ETIQUETA_BAJA,
  type FilaDato,
  marco,
  texto,
  textoPequeno,
  textoPlano,
  titulo,
} from './base.js';

/** Artículos que se nombran en el correo; del resto solo se dice cuántos más hay. */
export const ARTICULOS_EN_RECORDATORIO = 5;

export interface ArticuloRecordado {
  descripcion: string;
  cantidad: number;
}

interface DatosRecordatorioCarrito {
  asunto: string;
  nombre: string;
  /** Artículos del carrito al enviar, en el orden en que se agregaron. */
  articulos: ArticuloRecordado[];
  urlCarrito: string;
  /** Enlace firmado de baja (RNF-26). */
  enlaceBaja: string;
  enlacesPie: EnlacesPie;
  /** Imagen de apertura (E12-H6). */
  seguimiento?: string | null;
}

const unidades = (cantidad: number): string =>
  cantidad === 1 ? '1 unidad' : `${cantidad} unidades`;

/**
 * Recordatorio de un carrito abandonado (E12-H4). Sin diseño en Figma: usa la base de «Verificación
 * aprobada». Sin precios (decisión del 4 de noviembre de 2026): el carrito muestra los vigentes y
 * el correo no arriesga un precio viejo ni el mayorista (RNF-04). Es publicidad: lleva el enlace de
 * baja (RNF-26). PROPUESTA de texto por confirmar con el equipo.
 */
export const correoRecordatorioCarrito = ({
  asunto,
  nombre,
  articulos,
  urlCarrito,
  enlaceBaja,
  enlacesPie,
  seguimiento,
}: DatosRecordatorioCarrito): CorreoRenderizado => {
  const encabezado = 'Dejaste productos en tu carrito';
  const mensaje = `Hola, ${nombre}. Guardamos tu carrito para que termines tu compra cuando quieras.`;
  const nombrados = articulos.slice(0, ARTICULOS_EN_RECORDATORIO);
  const restantes = articulos.length - nombrados.length;
  const filas: FilaDato[] = nombrados.map(({ descripcion, cantidad }) => ({
    etiqueta: descripcion,
    valor: unidades(cantidad),
    etiquetaPrincipal: true,
  }));
  const otros =
    restantes > 0
      ? `Y ${restantes === 1 ? 'otro artículo' : `${restantes} artículos más`}.`
      : null;
  const nota =
    'Los precios y la disponibilidad son los del momento en que compres.';
  const accion = 'Ver mi carrito';
  const pie =
    'Cabello Perfecto te envía este correo porque aceptaste recibir sus ofertas.';

  return {
    html: marco({
      asunto,
      cuerpo: [
        titulo(encabezado),
        texto(mensaje),
        cajaDatos(filas),
        otros ? textoPequeno(otros) : '',
        boton(accion, urlCarrito),
        textoPequeno(nota),
      ].join(''),
      pie,
      enlaces: enlacesPie,
      baja: enlaceBaja,
      seguimiento,
    }),
    texto: textoPlano(
      encabezado,
      mensaje,
      nombrados
        .map(
          ({ descripcion, cantidad }) =>
            `- ${descripcion}: ${unidades(cantidad)}`,
        )
        .join('\n'),
      otros,
      `${accion}: ${urlCarrito}`,
      nota,
      pie,
      `${ETIQUETA_BAJA}: ${enlaceBaja}`,
    ),
  };
};
