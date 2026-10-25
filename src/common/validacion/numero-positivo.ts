import { ValidateBy, type ValidationArguments } from 'class-validator';
import { MAXIMO_INT4 } from './enteros.js';
import { type Presencia, segunPresencia } from './presencia.js';

interface OpcionesNumero extends Presencia {
  /** Cómo se nombra el dato en el mensaje: «El peso». */
  etiqueta: string;
  /** La etiqueta es femenina («La cantidad»): el mensaje dice «obligatoria». */
  femenino?: boolean;
  /** El valor puede ser 0 (el stock mínimo); si no, debe ser mayor que 0. */
  admiteCero?: boolean;
  /** Admite hasta dos decimales (columnas `Decimal(_, 2)`); si no, debe ser entero. */
  decimales?: boolean;
  /** Máximo que cabe en la columna. */
  maximo?: number;
}

/** Número positivo (o cero) que cabe en su columna, entero o con hasta dos decimales. */
export function NumeroPositivo({
  etiqueta,
  femenino,
  admiteCero,
  decimales,
  maximo = MAXIMO_INT4,
  presencia = 'obligatorio',
}: OpcionesNumero) {
  const formato = decimales ? /^\d+(\.\d{1,2})?$/ : /^\d+$/;
  return segunPresencia(presencia, [
    ValidateBy({
      name: 'numeroPositivo',
      validator: {
        validate: (valor: unknown) =>
          typeof valor === 'number' &&
          Number.isFinite(valor) &&
          formato.test(String(valor)) &&
          (admiteCero ? valor >= 0 : valor > 0) &&
          valor <= maximo,
        defaultMessage: (argumentos?: ValidationArguments) => {
          if (argumentos?.value === undefined || argumentos.value === null) {
            return `${etiqueta} es ${femenino ? 'obligatoria' : 'obligatorio'}.`;
          }
          const tipo = decimales
            ? 'un número con hasta dos decimales'
            : 'un número entero';
          const desde = admiteCero ? 'desde 0' : 'mayor que 0';
          return `${etiqueta} debe ser ${tipo} ${desde} y hasta ${maximo}.`;
        },
      },
    }),
  ]);
}
