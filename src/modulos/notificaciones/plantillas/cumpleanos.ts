import {
  aviso,
  boton,
  type CorreoRenderizado,
  type EnlacesPie,
  ETIQUETA_BAJA,
  marco,
  texto,
  textoConSaltos,
  textoPlano,
  titulo,
} from './base.js';
import { parrafosDe } from './campana.js';

interface DatosCumpleanos {
  asunto: string;
  nombre: string;
  /** Saludo en texto plano escrito en el panel: se escapa, así no puede inyectar HTML. */
  cuerpo: string;
  /** Texto de la oferta si el administrador la activó (E12-H5, CA2); si no, `null`. */
  oferta: string | null;
  urlCatalogo: string;
  /** Enlace firmado de baja (RNF-26). */
  enlaceBaja: string;
  enlacesPie: EnlacesPie;
  /** Imagen de apertura (E12-H6). */
  seguimiento?: string | null;
}

/** Encabezado del recuadro de la oferta. PROPUESTA por confirmar con el equipo. */
export const ENCABEZADO_OFERTA_CUMPLEANOS = 'Tu regalo de cumpleaños';

/**
 * Saludo de cumpleaños (E12-H5, RF-12.10 y RF-12.11). Sin diseño en Figma: usa la base de los
 * demás correos, con el asunto como título, el saludo en párrafos y, si está activa, la oferta en
 * un recuadro. Saludo y oferta son texto plano y siempre se escapan. Es publicidad: lleva
 * remitente y enlace de baja (RNF-26). Textos PROPUESTA por confirmar con el equipo.
 */
export const correoCumpleanos = ({
  asunto,
  nombre,
  cuerpo,
  oferta,
  urlCatalogo,
  enlaceBaja,
  enlacesPie,
  seguimiento,
}: DatosCumpleanos): CorreoRenderizado => {
  const saludo = `Hola, ${nombre}:`;
  const parrafos = parrafosDe(cuerpo);
  const accion = 'Ir a la tienda';
  const pie =
    'Cabello Perfecto te envía este correo porque aceptaste recibir sus ofertas.';

  return {
    html: marco({
      asunto,
      cuerpo: [
        titulo(asunto),
        texto(saludo),
        ...parrafos.map(textoConSaltos),
        oferta ? aviso(ENCABEZADO_OFERTA_CUMPLEANOS, oferta) : '',
        boton(accion, urlCatalogo),
      ].join(''),
      pie,
      enlaces: enlacesPie,
      baja: enlaceBaja,
      seguimiento,
    }),
    texto: textoPlano(
      asunto,
      saludo,
      ...parrafos,
      oferta ? `${ENCABEZADO_OFERTA_CUMPLEANOS}: ${oferta}` : null,
      `${accion}: ${urlCatalogo}`,
      pie,
      `${ETIQUETA_BAJA}: ${enlaceBaja}`,
    ),
  };
};
