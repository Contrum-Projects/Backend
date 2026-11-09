/**
 * Prueba manual de la OT contra Chilexpress (SCRUM-153): crea una OT de ejemplo, guarda su etiqueta
 * y consulta su seguimiento con el mismo código que usa la API (lo compilado en `dist/`).
 *
 *   pnpm chilexpress:probar-ot
 *
 * Lee del `.env` la clave de la API Envíos (`CHILEXPRESS_CLAVE_ENVIOS`, obligatoria) y, si están, la
 * TCC, el RUT de la empresa, el remitente y la URL. Sin ellos usa los valores de prueba que publica
 * Chilexpress (TCC 18578680, RUT 96756430) y su ambiente de prueba. Nunca imprime la clave.
 * Sin `CHILEXPRESS_URL_BASE` va al ambiente de prueba: no crea OT reales. Con otra URL se niega,
 * salvo que se agregue `--produccion` (`pnpm chilexpress:probar-ot -- --produccion`).
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CreadorOtChilexpress } from '../dist/modulos/despacho/orden-transporte-chilexpress.js';
import { URL_SANDBOX_CHILEXPRESS } from '../dist/modulos/despacho/orden-transporte.js';
import { SeguimientoChilexpress } from '../dist/modulos/despacho/seguimiento-chilexpress.js';

const env = process.env;
const clave = env.CHILEXPRESS_CLAVE_ENVIOS;
if (!clave) {
  console.error(
    'Falta CHILEXPRESS_CLAVE_ENVIOS en el .env (la clave de la API Envíos).',
  );
  process.exit(1);
}
const urlBase = (env.CHILEXPRESS_URL_BASE || URL_SANDBOX_CHILEXPRESS).replace(
  /\/+$/,
  '',
);
// Una prueba nunca crea una OT real sin pedirlo: fuera del ambiente de prueba exige --produccion
if (
  urlBase !== URL_SANDBOX_CHILEXPRESS &&
  !process.argv.includes('--produccion')
) {
  console.error(
    `CHILEXPRESS_URL_BASE apunta a ${urlBase}: esto crearía una OT real. Si es lo que quieres, agrega --produccion.`,
  );
  process.exit(1);
}
const tcc = env.CHILEXPRESS_TCC || '18578680';
const rut = Number(env.CHILEXPRESS_RUT_EMPRESA || '96756430');
const remitente = {
  nombre: env.CHILEXPRESS_REMITENTE_NOMBRE || 'Cabello Perfecto (prueba)',
  telefono: env.CHILEXPRESS_REMITENTE_TELEFONO || '+56911111111',
  correo: env.CHILEXPRESS_REMITENTE_CORREO || 'pruebas@cabelloperfecto.cl',
};
const referencia = `PRUEBA${Date.now().toString().slice(-6)}`;

console.log(
  `Ambiente: ${urlBase === URL_SANDBOX_CHILEXPRESS ? 'PRUEBA' : urlBase}`,
);
console.log(`TCC: ${tcc} · RUT empresa: ${rut} · referencia: ${referencia}`);

const creador = new CreadorOtChilexpress(clave, tcc, remitente, urlBase);
let ot;
try {
  ot = await creador.crear({
    origen: 'STGO',
    destino: {
      cobertura: 'PROV',
      calle: 'Avenida Manuel Montt',
      numero: '427',
      complemento: 'Depto. 301',
    },
    devolucion: {
      cobertura: 'STGO',
      calle: 'Av. Matta 1234',
      numero: null,
      complemento: null,
    },
    destinatario: {
      nombre: 'Destinatario de prueba',
      telefono: '+56912345678',
      correo: 'destinatario@prueba.cl',
    },
    bulto: { pesoGramos: 640, altoCm: 15, anchoCm: 15, largoCm: 15 },
    codigoServicio: 3,
    referencia,
    valorDeclarado: 25990,
  });
} catch (error) {
  console.error(`No se creó la OT: ${error.message}`);
  process.exit(1);
}

console.log(`OT creada: ${ot.numero}`);
if (ot.etiqueta) {
  const contenido = Buffer.from(ot.etiqueta, 'base64');
  const inicio = contenido.subarray(0, 4).toString('latin1');
  const extension = inicio.startsWith('%PDF')
    ? 'pdf'
    : inicio.startsWith('\x89PNG')
      ? 'png'
      : inicio.startsWith('\xFF\xD8\xFF')
        ? 'jpg'
        : 'bin';
  const archivo = join(tmpdir(), `etiqueta-${ot.numero}.${extension}`);
  writeFileSync(archivo, contenido);
  console.log(`Etiqueta (${extension}, ${contenido.length} bytes): ${archivo}`);
} else {
  console.log('Chilexpress no devolvió etiqueta.');
}

const seguimiento = new SeguimientoChilexpress(clave, urlBase, rut);
try {
  const estado = await seguimiento.consultar({
    codigoSeguimiento: ot.numero,
    referencia,
  });
  console.log(
    `Seguimiento: ${estado ?? 'sin eventos con estado conocido todavía (normal en una OT recién creada)'}`,
  );
} catch (error) {
  console.error(`El seguimiento falló: ${error.message}`);
  process.exit(1);
}
