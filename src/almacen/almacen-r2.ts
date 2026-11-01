import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ServiceUnavailableException } from '@nestjs/common';
import { AlmacenArchivos } from './almacen-archivos.js';

export interface ConfiguracionR2 {
  cuenta: string;
  idClave: string;
  claveSecreta: string;
  bucket: string;
}

/** Cloudflare R2 por su API compatible con S3. */
export class AlmacenR2 extends AlmacenArchivos {
  private readonly cliente: S3Client;

  constructor(private readonly configuracion: ConfiguracionR2) {
    super();
    this.cliente = new S3Client({
      region: 'auto',
      endpoint: `https://${configuracion.cuenta}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: configuracion.idClave,
        secretAccessKey: configuracion.claveSecreta,
      },
    });
  }

  async guardar(
    clave: string,
    contenido: Buffer,
    tipoContenido: string,
    privado = false,
  ) {
    await this.cliente.send(
      new PutObjectCommand({
        Bucket: this.configuracion.bucket,
        Key: clave,
        Body: contenido,
        ContentType: tipoContenido,
        // La clave es única por archivo y nunca se reescribe: se puede guardar en caché, salvo
        // un archivo privado (una factura), que no debe quedar en cachés compartidas
        CacheControl: privado
          ? 'private, no-store'
          : 'public, max-age=31536000, immutable',
      }),
    );
  }

  async eliminar(clave: string) {
    await this.cliente.send(
      new DeleteObjectCommand({
        Bucket: this.configuracion.bucket,
        Key: clave,
      }),
    );
  }

  async obtener(clave: string) {
    const respuesta = await this.cliente.send(
      new GetObjectCommand({ Bucket: this.configuracion.bucket, Key: clave }),
    );
    if (!respuesta.Body) throw new Error(`El archivo ${clave} llegó vacío.`);
    return Buffer.from(await respuesta.Body.transformToByteArray());
  }
}

/** Sin credenciales de R2: la app arranca, pero no se pueden subir archivos. */
export class AlmacenNoConfigurado extends AlmacenArchivos {
  guardar(): Promise<void> {
    return Promise.reject(
      new ServiceUnavailableException(
        'El almacenamiento de archivos no está configurado.',
      ),
    );
  }

  // Nada que borrar: sin almacén no se subió ningún archivo
  eliminar(): Promise<void> {
    return Promise.resolve();
  }

  obtener(): Promise<Buffer> {
    return Promise.reject(
      new ServiceUnavailableException(
        'El almacenamiento de archivos no está configurado.',
      ),
    );
  }
}
