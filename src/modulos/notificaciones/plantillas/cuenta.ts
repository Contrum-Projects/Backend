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

interface DatosVerificacionAprobada {
  asunto: string;
  nombre: string;
  urlCatalogo: string;
  enlacesPie: EnlacesPie;
}

/**
 * Verificación aprobada (E10-H4), según el diseño de Figma, con tres cambios decididos el 3 de
 * noviembre de 2026: un mismo texto para la aprobación automática y la manual (la automática no
 * revisa documentos); sin el recuadro de «al menos 3 unidades de cada formato», que dejó de regir
 * con SCRUM-146; y sin «Completa tu perfil profesional» hasta que exista el perfil (RF-10.11).
 */
export const correoVerificacionAprobada = ({
  asunto,
  nombre,
  urlCatalogo,
  enlacesPie,
}: DatosVerificacionAprobada): CorreoRenderizado => {
  const encabezado = 'Tu cuenta profesional está activa';
  const mensaje = `Hola, ${nombre}. Aprobamos tu verificación. Desde ahora ves el precio profesional en todo el catálogo.`;
  const accion = 'Ver precios profesionales';
  const pie =
    'Recibes este correo porque pediste verificar tu cuenta como profesional.';
  return {
    html: marco({
      asunto,
      cuerpo: [
        titulo(encabezado),
        texto(mensaje),
        boton(accion, urlCatalogo),
      ].join(''),
      pie,
      enlaces: enlacesPie,
    }),
    texto: textoPlano(encabezado, mensaje, `${accion}: ${urlCatalogo}`, pie),
  };
};

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
