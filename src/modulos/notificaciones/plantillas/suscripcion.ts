import type { CorreoRenderizado, EnlacesPie } from './base.js';
import { correoConEnlace, vigencia } from './cuenta.js';

interface DatosConfirmacionSuscripcion {
  asunto: string;
  destinatario: string;
  enlace: string;
  /** Vigencia máxima del enlace, en horas: reencolado, conserva el vencimiento original. */
  horas: number;
  enlacesPie: EnlacesPie;
}

/**
 * Confirmación de la suscripción a ofertas (E12-H1). Sin diseño propio en Figma: usa la base de
 * «Confirma tu correo». No es publicidad, así que no lleva el correo para pedir la baja (RNF-26): mientras no se
 * confirme, la dirección no recibe ofertas.
 */
export const correoConfirmacionSuscripcion = ({
  asunto,
  destinatario,
  enlace,
  horas,
  enlacesPie,
}: DatosConfirmacionSuscripcion): CorreoRenderizado =>
  correoConEnlace({
    asunto,
    encabezado: 'Confirma tu suscripción',
    mensaje: `Pediste recibir las ofertas de Cabello Perfecto en ${destinatario}. Confirma tu suscripción para empezar a recibirlas. El enlace dura como máximo ${vigencia(horas)}.`,
    accion: 'Confirmar mi suscripción',
    enlace,
    nota: 'Si no lo pediste, ignora este correo: no te enviaremos ofertas.',
    pie: 'Recibes este correo porque se pidió suscribir esta dirección a las ofertas de Cabello Perfecto.',
    enlacesPie,
  });
