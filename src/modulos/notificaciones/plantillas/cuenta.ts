import {
  boton,
  type CorreoRenderizado,
  divisor,
  enlaceVisible,
  type EnlacesPie,
  marco,
  texto,
  textoPequeno,
  textoPlano,
  titulo,
} from './base.js';

const SI_NO_FUNCIONA =
  'Si el botón no funciona, copia este enlace en tu navegador:';

interface CorreoConEnlace {
  asunto: string;
  encabezado: string;
  /** Párrafos del cuerpo, antes del botón. */
  mensaje: string;
  accion: string;
  enlace: string;
  /** Advertencia al final del cuerpo. */
  nota: string;
  pie: string;
  enlacesPie: EnlacesPie;
}

/**
 * Base de los correos con enlace de un uso, según el diseño de «Confirma tu correo». Recuperación e
 * invitación no tienen diseño propio en Figma: usan esta misma base.
 */
const correoConEnlace = (datos: CorreoConEnlace): CorreoRenderizado => ({
  html: marco({
    asunto: datos.asunto,
    cuerpo: [
      titulo(datos.encabezado),
      texto(datos.mensaje),
      boton(datos.accion, datos.enlace),
      textoPequeno(SI_NO_FUNCIONA),
      enlaceVisible(datos.enlace),
      divisor(),
      textoPequeno(datos.nota),
    ].join(''),
    pie: datos.pie,
    enlaces: datos.enlacesPie,
  }),
  texto: textoPlano(
    datos.encabezado,
    datos.mensaje,
    `${datos.accion}: ${datos.enlace}`,
    datos.nota,
    datos.pie,
  ),
});

/**
 * Confirmación y recuperación van sin el nombre (el diseño lo mostraba): esa dirección aún no está
 * confirmada, y quien se registre con un correo ajeno podría usar el nombre para hacerle llegar un
 * texto engañoso desde el dominio de la tienda.
 */
interface DatosConfirmacion {
  asunto: string;
  destinatario: string;
  enlace: string;
  enlacesPie: EnlacesPie;
}

export const correoConfirmacion = ({
  asunto,
  destinatario,
  enlace,
  enlacesPie,
}: DatosConfirmacion): CorreoRenderizado =>
  correoConEnlace({
    asunto,
    encabezado: 'Confirma tu correo',
    mensaje: `Creaste una cuenta en Cabello Perfecto con ${destinatario}. Confirma que esta dirección es tuya para poder comprar.`,
    accion: 'Confirmar mi correo',
    enlace,
    nota: 'Si no creaste esta cuenta, ignora este correo.',
    pie: 'Recibes este correo porque se creó una cuenta en Cabello Perfecto con esta dirección.',
    enlacesPie,
  });

interface DatosEnlaceConVigencia {
  asunto: string;
  enlace: string;
  /** Vigencia máxima del enlace, en horas: reencolado, conserva el vencimiento original. */
  horas: number;
  enlacesPie: EnlacesPie;
}

const vigencia = (horas: number): string =>
  horas === 1 ? '1 hora' : `${horas} horas`;

export const correoRecuperacion = ({
  asunto,
  enlace,
  horas,
  enlacesPie,
}: DatosEnlaceConVigencia): CorreoRenderizado =>
  correoConEnlace({
    asunto,
    encabezado: 'Recupera tu contraseña',
    mensaje: `Recibimos una solicitud para cambiar la contraseña de tu cuenta. El enlace sirve una sola vez y dura como máximo ${vigencia(horas)}.`,
    accion: 'Crear contraseña nueva',
    enlace,
    nota: 'Si no lo pediste, ignora este correo: tu contraseña no cambiará.',
    pie: 'Recibes este correo porque se pidió recuperar la contraseña de tu cuenta en Cabello Perfecto.',
    enlacesPie,
  });

export const correoInvitacion = ({
  asunto,
  enlace,
  horas,
  enlacesPie,
  nombre,
}: DatosEnlaceConVigencia & { nombre: string }): CorreoRenderizado =>
  correoConEnlace({
    asunto,
    encabezado: `Te invitamos al panel, ${nombre}`,
    mensaje: `Te crearon una cuenta de personal en el panel de Cabello Perfecto. Define tu contraseña para empezar. El enlace sirve una sola vez y dura como máximo ${vigencia(horas)}.`,
    accion: 'Definir mi contraseña',
    enlace,
    nota: 'Si no esperabas esta invitación, ignora este correo.',
    pie: 'Recibes este correo porque te invitaron a trabajar en el panel de Cabello Perfecto.',
    enlacesPie,
  });
