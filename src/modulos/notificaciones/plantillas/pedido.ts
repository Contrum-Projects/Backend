import { ESTADOS_PEDIDO } from '../../../common/dominio/valores.js';
import {
  boton,
  cajaDatos,
  type CorreoRenderizado,
  type EnlacesPie,
  fechaLarga,
  type FilaDato,
  filasTotal,
  formatearPesos,
  marco,
  type PasoPedido,
  pasos,
  seccion,
  texto,
  textoPlano,
  titulo,
} from './base.js';

const PIE_COMPRA = 'Recibes este correo porque compraste en Cabello Perfecto.';
const VER_PEDIDO = 'Ver mi pedido';
const DOCUMENTO =
  'Puedes descargar tu comprobante de pago desde el detalle del pedido.';

export interface LineaCorreoPago {
  descripcion: string;
  monto: number;
}

export interface DatosPagoConfirmado {
  asunto: string;
  nombre: string;
  codigoPedido: string;
  lineas: LineaCorreoPago[];
  /** Costo con IVA del despacho; `null` si retira en tienda. */
  despacho: { comuna: string; costo: number } | null;
  total: number;
  iva: number;
  /** `Despacho a domicilio · …` o `Retiro en tienda`. */
  entrega: string;
  urlPedido: string;
  enlacesPie: EnlacesPie;
}

export const correoPagoConfirmado = (
  datos: DatosPagoConfirmado,
): CorreoRenderizado => {
  const siguiente = datos.despacho
    ? 'Te avisaremos por correo cuando salga a despacho.'
    : 'Te avisaremos por correo cuando esté listo para retiro.';
  const mensaje = `Hola, ${datos.nombre}. Tu pedido ${datos.codigoPedido} quedó pagado. ${siguiente}`;
  const filas: FilaDato[] = datos.lineas.map((linea) => ({
    etiqueta: linea.descripcion,
    valor: formatearPesos(linea.monto),
    etiquetaPrincipal: true,
  }));
  if (datos.despacho) {
    filas.push({
      etiqueta: `Despacho a ${datos.despacho.comuna}`,
      valor: formatearPesos(datos.despacho.costo),
    });
  }
  const total = formatearPesos(datos.total);
  const notaIva = `IVA incluido: ${formatearPesos(datos.iva)}`;

  return {
    html: marco({
      asunto: datos.asunto,
      cuerpo: [
        titulo('Recibimos tu pago'),
        texto(mensaje),
        cajaDatos(filas, filasTotal(total, notaIva)),
        seccion('Entrega', datos.entrega),
        seccion('Documento', DOCUMENTO),
        boton(VER_PEDIDO, datos.urlPedido),
      ].join(''),
      pie: PIE_COMPRA,
      enlaces: datos.enlacesPie,
    }),
    texto: textoPlano(
      'Recibimos tu pago',
      mensaje,
      [
        ...filas.map((f) => `${f.etiqueta}: ${f.valor}`),
        `Total pagado: ${total}`,
        notaIva,
      ].join('\n'),
      `Entrega: ${datos.entrega}`,
      `Documento: ${DOCUMENTO}`,
      `${VER_PEDIDO}: ${datos.urlPedido}`,
      PIE_COMPRA,
    ),
  };
};

export interface DatosCambioEstado {
  asunto: string;
  nombre: string;
  codigoPedido: string;
  /** `ESTADOS_CON_AVISO`. */
  estado: string;
  /** Cuándo el pedido llegó a ese estado. */
  fecha: Date;
  pasos: PasoPedido[];
  /** `null` si retira en tienda. */
  envio: {
    servicio: string;
    codigoSeguimiento: string | null;
    direccion: string;
  } | null;
  urlPedido: string;
  enlacesPie: EnlacesPie;
}

/** Título y mensaje de cada estado; el diseño es el mismo y cambian estos y el paso marcado. */
const TEXTOS_ESTADO: Record<
  string,
  { titulo: string; mensaje: (codigo: string, fecha: string) => string }
> = {
  [ESTADOS_PEDIDO.DESPACHADO]: {
    titulo: 'Tu pedido va en camino',
    mensaje: (codigo, fecha) => `Despachamos tu pedido ${codigo} el ${fecha}.`,
  },
  [ESTADOS_PEDIDO.ENTREGADO]: {
    titulo: 'Tu pedido fue entregado',
    mensaje: (codigo, fecha) => `Entregamos tu pedido ${codigo} el ${fecha}.`,
  },
  [ESTADOS_PEDIDO.LISTO_PARA_RETIRO]: {
    titulo: 'Tu pedido está listo para retiro',
    mensaje: (codigo, fecha) =>
      `Tu pedido ${codigo} quedó listo para retiro el ${fecha}.`,
  },
  [ESTADOS_PEDIDO.RETIRADO]: {
    titulo: 'Retiraste tu pedido',
    mensaje: (codigo, fecha) => `Retiraste tu pedido ${codigo} el ${fecha}.`,
  },
};

export const correoCambioEstado = (
  datos: DatosCambioEstado,
): CorreoRenderizado => {
  const textos = TEXTOS_ESTADO[datos.estado];
  if (!textos) {
    throw new Error(`Estado sin correo: ${datos.estado}`);
  }
  const mensaje = `Hola, ${datos.nombre}. ${textos.mensaje(datos.codigoPedido, fechaLarga(datos.fecha))}`;
  const filas: FilaDato[] = datos.envio
    ? [
        { etiqueta: 'Envío', valor: datos.envio.servicio, fuerte: true },
        ...(datos.envio.codigoSeguimiento
          ? [
              {
                etiqueta: 'Código de seguimiento',
                valor: datos.envio.codigoSeguimiento,
                fuerte: true,
              },
            ]
          : []),
        { etiqueta: 'Dirección', valor: datos.envio.direccion },
      ]
    : [];

  return {
    html: marco({
      asunto: datos.asunto,
      cuerpo: [
        titulo(textos.titulo),
        texto(mensaje),
        pasos(datos.pasos),
        filas.length > 0 ? cajaDatos(filas) : '',
        boton(VER_PEDIDO, datos.urlPedido),
      ].join(''),
      pie: PIE_COMPRA,
      enlaces: datos.enlacesPie,
    }),
    texto: textoPlano(
      textos.titulo,
      mensaje,
      filas.length > 0
        ? filas.map((f) => `${f.etiqueta}: ${f.valor}`).join('\n')
        : null,
      `${VER_PEDIDO}: ${datos.urlPedido}`,
      PIE_COMPRA,
    ),
  };
};
