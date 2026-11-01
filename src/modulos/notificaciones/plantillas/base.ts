/**
 * Piezas de las plantillas de correo, según la página «Correos» de Figma. Los clientes de correo
 * solo respetan tablas y estilos en línea; Gmail y Outlook ignoran Fraunces y DM Sans y usan el
 * respaldo de cada pila de fuentes.
 */
export interface CorreoRenderizado {
  html: string;
  texto: string;
}

export const ID_LOGO = 'logo-cabello-perfecto';

export const COLORES = {
  profundo: '#0b3b3a',
  logo: '#2ed3c2',
  superficie: '#fffcf6',
  hueso: '#f3efe6',
  huesoOscuro: '#e6dfd0',
  textoPrincipal: '#2a2e2d',
  textoSecundario: '#5c6361',
  textoSobreOscuro: '#f3efe6',
  avisoFondo: '#fdf0d5',
  avisoTexto: '#8a4b08',
} as const;

const FUENTE_TITULO = "Fraunces, Georgia, 'Times New Roman', serif";
const FUENTE_CUERPO = "'DM Sans', Arial, Helvetica, sans-serif";

const ZONA_HORARIA = 'America/Santiago';

export const escapar = (texto: string): string =>
  texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const formatearPesos = (monto: number): string =>
  `$${new Intl.NumberFormat('es-CL').format(monto)}`;

const partesFecha = (fecha: Date, mes: 'long' | 'short') => {
  const partes = new Intl.DateTimeFormat('es-CL', {
    timeZone: ZONA_HORARIA,
    day: 'numeric',
    month: mes,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(fecha);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? '';
  return {
    dia: parte('day'),
    mes: parte('month').replace('.', ''),
    hora: `${parte('hour')}:${parte('minute')}`,
  };
};

/** `11 de octubre a las 17:05` */
export const fechaLarga = (fecha: Date): string => {
  const { dia, mes, hora } = partesFecha(fecha, 'long');
  return `${dia} de ${mes} a las ${hora}`;
};

/** `11 oct` */
export const fechaCorta = (fecha: Date): string => {
  const { dia, mes } = partesFecha(fecha, 'short');
  return `${dia} ${mes}`;
};

/** `12 oct, 10:15` */
export const fechaConHora = (fecha: Date): string =>
  `${fechaCorta(fecha)}, ${partesFecha(fecha, 'short').hora}`;

const parrafo = (
  contenido: string,
  estilo: { tamano: number; linea: number; color: string; extra?: string },
): string =>
  `<p style="margin:0;font-family:${FUENTE_CUERPO};font-size:${estilo.tamano}px;line-height:${estilo.linea};color:${estilo.color};${estilo.extra ?? ''}">${contenido}</p>`;

/** Bloque del cuerpo: el diseño separa cada uno con 20 px. */
const bloque = (contenido: string): string =>
  `<tr><td style="padding:0 0 20px 0;">${contenido}</td></tr>`;

export const titulo = (texto: string): string =>
  bloque(
    `<h1 style="margin:0;font-family:${FUENTE_TITULO};font-size:28px;font-weight:400;line-height:1.2;letter-spacing:-0.3px;color:${COLORES.profundo};">${escapar(texto)}</h1>`,
  );

export const texto = (contenido: string): string =>
  bloque(
    parrafo(escapar(contenido), {
      tamano: 16,
      linea: 1.5,
      color: COLORES.textoPrincipal,
    }),
  );

export const textoPequeno = (contenido: string): string =>
  bloque(
    parrafo(escapar(contenido), {
      tamano: 14,
      linea: 1.45,
      color: COLORES.textoSecundario,
    }),
  );

export const boton = (etiqueta: string, url: string): string =>
  bloque(
    `<a href="${escapar(url)}" style="display:inline-block;padding:16px 28px;border-radius:999px;background-color:${COLORES.profundo};font-family:${FUENTE_CUERPO};font-size:16px;font-weight:600;line-height:1.5;color:${COLORES.textoSobreOscuro};text-decoration:none;">${escapar(etiqueta)}</a>`,
  );

/** Enlace visible por si el botón no funciona (`word-break`: el token es largo). */
export const enlaceVisible = (url: string): string =>
  bloque(
    `<a href="${escapar(url)}" style="font-family:${FUENTE_CUERPO};font-size:14px;line-height:1.45;color:${COLORES.profundo};word-break:break-all;">${escapar(url)}</a>`,
  );

const lineaDivisoria = `<div style="height:1px;line-height:1px;font-size:0;background-color:${COLORES.huesoOscuro};">&nbsp;</div>`;

export const divisor = (): string => bloque(lineaDivisoria);

/** Etiqueta y texto, como «Entrega» y «Documento». */
export const seccion = (etiqueta: string, contenido: string): string =>
  bloque(
    parrafo(escapar(etiqueta), {
      tamano: 14,
      linea: 1.3,
      color: COLORES.textoPrincipal,
      extra: 'font-weight:600;letter-spacing:0.2px;padding-bottom:4px;',
    }) +
      parrafo(escapar(contenido), {
        tamano: 14,
        linea: 1.45,
        color: COLORES.textoSecundario,
      }),
  );

export interface FilaDato {
  etiqueta: string;
  valor: string;
  /** Valor en negrita, como el courier y el código de seguimiento. */
  fuerte?: boolean;
  /** Etiqueta en color secundario; por defecto, sí. */
  etiquetaPrincipal?: boolean;
}

const filaDato = ({
  etiqueta,
  valor,
  fuerte,
  etiquetaPrincipal,
}: FilaDato): string =>
  `<tr><td style="padding:5px 12px 5px 0;font-family:${FUENTE_CUERPO};font-size:16px;line-height:1.5;color:${etiquetaPrincipal ? COLORES.textoPrincipal : COLORES.textoSecundario};">${escapar(etiqueta)}</td><td align="right" style="padding:5px 0;font-family:${FUENTE_CUERPO};font-size:16px;line-height:1.5;color:${COLORES.textoPrincipal};${fuerte ? 'font-weight:600;' : ''}">${escapar(valor)}</td></tr>`;

/** Caja hueso con filas de dos columnas; `despues` agrega filas ya armadas al final. */
export const cajaDatos = (filas: FilaDato[], despues = ''): string =>
  bloque(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORES.hueso};border-radius:8px;"><tr><td style="padding:15px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas.map(filaDato).join('')}${despues}</table></td></tr></table>`,
  );

/** Filas finales de la caja de montos: línea divisoria, total e IVA. */
export const filasTotal = (total: string, nota: string): string =>
  `<tr><td colspan="2" style="padding:7px 0;">${lineaDivisoria}</td></tr><tr><td style="padding:5px 12px 5px 0;font-family:${FUENTE_CUERPO};font-size:16px;font-weight:600;line-height:1.5;color:${COLORES.textoPrincipal};">Total pagado</td><td align="right" style="padding:5px 0;font-family:${FUENTE_CUERPO};font-size:20px;font-weight:700;line-height:1.2;color:${COLORES.textoPrincipal};">${escapar(total)}</td></tr><tr><td colspan="2" style="padding:5px 0;font-family:${FUENTE_CUERPO};font-size:14px;line-height:1.45;color:${COLORES.textoSecundario};">${escapar(nota)}</td></tr>`;

/** Aviso destacado, como el de stock bajo. */
export const aviso = (encabezado: string, contenido: string): string =>
  bloque(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORES.avisoFondo};border-radius:8px;"><tr><td style="padding:16px;">${parrafo(
      escapar(encabezado),
      {
        tamano: 14,
        linea: 1.3,
        color: COLORES.avisoTexto,
        extra: 'font-weight:600;letter-spacing:0.2px;padding-bottom:4px;',
      },
    )}${parrafo(escapar(contenido), {
      tamano: 14,
      linea: 1.45,
      color: COLORES.avisoTexto,
    })}</td></tr></table>`,
  );

export interface PasoPedido {
  etiqueta: string;
  /** Ya vacía si el paso aún no ocurre. */
  fecha: string | null;
  situacion: 'hecho' | 'actual' | 'futuro';
}

/** Línea de avance del pedido: un paso por columna. */
export const pasos = (lista: PasoPedido[]): string => {
  const ancho = Math.floor(100 / lista.length);
  const celdas = lista.map(({ etiqueta, fecha, situacion }, indice) => {
    const futuro = situacion === 'futuro';
    const relleno = indice === lista.length - 1 ? '0' : '0 8px 0 0';
    const barra = `<div style="height:4px;line-height:4px;font-size:0;border-radius:2px;background-color:${futuro ? COLORES.huesoOscuro : COLORES.profundo};">&nbsp;</div>`;
    const nombre = parrafo(escapar(etiqueta), {
      tamano: 14,
      linea: 1.4,
      color: futuro ? COLORES.textoSecundario : COLORES.textoPrincipal,
      extra: `padding-top:6px;${situacion === 'actual' ? 'font-weight:600;' : ''}`,
    });
    const dia = fecha
      ? parrafo(escapar(fecha), {
          tamano: 12,
          linea: 1.35,
          color: COLORES.textoSecundario,
          extra: 'font-weight:500;letter-spacing:0.4px;padding-top:6px;',
        })
      : '';
    return `<td width="${ancho}%" valign="top" style="padding:${relleno};">${barra}${nombre}${dia}</td>`;
  });
  return bloque(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${celdas.join('')}</tr></table>`,
  );
};

export interface EnlacesPie {
  ayuda: string;
  terminos: string;
  privacidad: string;
}

/**
 * Rutas de las páginas del pie y de las pantallas a las que llevan los correos. PROPUESTA por
 * confirmar con el equipo de frontend.
 */
export const rutasTienda = (urlTienda: string) => {
  const base = urlTienda.replace(/\/+$/, '');
  return {
    pie: {
      ayuda: `${base}/ayuda`,
      terminos: `${base}/terminos`,
      privacidad: `${base}/privacidad`,
    },
    pedido: (codigo: string) =>
      `${base}/mis-pedidos/${encodeURIComponent(codigo)}`,
    inventario: `${base}/panel/inventario`,
  };
};

const enlacePie = (etiqueta: string, url: string): string =>
  `<a href="${escapar(url)}" style="color:${COLORES.textoSecundario};text-decoration:none;">${etiqueta}</a>`;

interface MarcoCorreo {
  asunto: string;
  cuerpo: string;
  pie: string;
  enlaces?: EnlacesPie;
  /** Cabecera con la marca «Panel»: correos para el personal. */
  panel?: boolean;
}

/** Cabecera con el logo, cuerpo y pie, comunes a todos los correos. */
export const marco = ({
  asunto,
  cuerpo,
  pie,
  enlaces,
  panel,
}: MarcoCorreo): string => {
  const marcaPanel = panel
    ? `<td style="padding-left:12px;font-family:${FUENTE_CUERPO};font-size:14px;font-weight:600;letter-spacing:0.2px;color:${COLORES.logo};">Panel</td>`
    : '';
  const estiloPie = `font-family:${FUENTE_CUERPO};font-size:12px;font-weight:500;line-height:1.35;letter-spacing:0.4px;color:${COLORES.textoSecundario};`;
  const filaEnlaces = enlaces
    ? `<p style="margin:6px 0 0 0;${estiloPie}">${enlacePie('Ayuda', enlaces.ayuda)} · ${enlacePie('Términos y condiciones', enlaces.terminos)} · ${enlacePie('Política de privacidad', enlaces.privacidad)}</p>`
    : '';

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapar(asunto)}</title><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Fraunces&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background-color:${COLORES.hueso};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORES.hueso};"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:${COLORES.superficie};border-radius:12px;overflow:hidden;">
<tr><td style="padding:16px 40px;background-color:${COLORES.profundo};"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td><img src="cid:${ID_LOGO}" width="74" height="44" alt="Cabello Perfecto" style="display:block;border:0;"></td>${marcaPanel}</tr></table></td></tr>
<tr><td style="padding:36px 40px 16px 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cuerpo}</table></td></tr>
<tr><td style="padding:24px 40px;background-color:${COLORES.huesoOscuro};"><p style="margin:0;${estiloPie}">${escapar(pie)}</p>${filaEnlaces}</td></tr>
</table></td></tr></table></body></html>`;
};

/** Versión en texto plano: párrafos separados por una línea en blanco. */
export const textoPlano = (...parrafos: (string | null)[]): string =>
  parrafos.filter((p) => p !== null).join('\n\n');
