import {
  type CorreoRenderizado,
  type EnlacesPie,
  marco,
  textoConSaltos,
  textoPlano,
  titulo,
  textoBaja,
} from './base.js';

interface DatosCampana {
  asunto: string;
  /** Texto plano escrito en el panel: se escapa, así no puede inyectar HTML. */
  cuerpo: string;
  /** Correo de contacto para pedir la baja (RNF-26). */
  correoBaja: string;
  enlacesPie: EnlacesPie;
  /** Imagen de apertura (E12-H6). La vista previa no la lleva: no es un envío. */
  seguimiento?: string | null;
}

/** Párrafos del cuerpo: los separa una línea en blanco; dentro de cada uno se conservan los saltos. */
export const parrafosDe = (cuerpo: string): string[] =>
  cuerpo
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((parrafo) => parrafo.trim())
    .filter((parrafo) => parrafo.length > 0);

/**
 * Correo de una campaña (E12-H3). Sin diseño en Figma: usa la base de los demás correos, con el
 * asunto como título y el cuerpo en párrafos. El cuerpo es texto plano (decisión del 5 de noviembre
 * de 2026) y siempre se escapa. Es publicidad: lleva remitente y correo para pedir la baja (RNF-26). Texto
 * del pie PROPUESTA por confirmar con el equipo.
 */
export const correoCampana = ({
  asunto,
  cuerpo,
  correoBaja,
  enlacesPie,
  seguimiento,
}: DatosCampana): CorreoRenderizado => {
  const parrafos = parrafosDe(cuerpo);
  const pie =
    'Cabello Perfecto te envía este correo porque aceptaste recibir sus ofertas.';

  return {
    html: marco({
      asunto,
      cuerpo: [titulo(asunto), ...parrafos.map(textoConSaltos)].join(''),
      pie,
      enlaces: enlacesPie,
      baja: correoBaja,
      seguimiento,
    }),
    texto: textoPlano(asunto, ...parrafos, pie, textoBaja(correoBaja)),
  };
};
