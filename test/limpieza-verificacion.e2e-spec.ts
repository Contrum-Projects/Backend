import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AlmacenArchivos } from '../src/almacen/almacen-archivos.js';
import { ROLES } from '../src/common/dominio/roles.js';
import { ESTADOS_SOLICITUD } from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { LimpiezaVerificacionService } from '../src/modulos/verificacion/limpieza-verificacion.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.
// Las solicitudes y sus documentos se crean directo en la base, con fechas relativas a un «ahora»
// un año en el futuro: la tarea programada, que corre con el reloj real, nunca las toma, así los
// bordes exactos se prueban sin carreras.

const PREFIJO_CORREO = 'e2e-limpieza-verificacion-';
const DIA = 24 * 60 * 60 * 1000;
const GIROS = [
  { codigo: '960200', nombre: 'PELUQUERIA', fechaInicio: '2019-03-01' },
];

/** Almacén de prueba: registra qué claves se borraron. */
class AlmacenDePrueba extends AlmacenArchivos {
  readonly eliminadas = new Set<string>();

  guardar() {
    return Promise.reject(new Error('esta prueba no guarda archivos'));
  }

  eliminar(clave: string) {
    this.eliminadas.add(clave);
    return Promise.resolve();
  }

  obtener() {
    return Promise.reject(new Error('esta prueba no lee archivos'));
  }

  urlTemporal() {
    return Promise.reject(new Error('esta prueba no firma enlaces'));
  }
}

describe('Verificación · eliminar archivos que ya no hacen falta (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let servicio: LimpiezaVerificacionService;
  const almacen = new AlmacenDePrueba();
  const ahora = new Date(Date.now() + 365 * DIA);
  const hace = (dias: number, ms = 0) =>
    new Date(ahora.getTime() - dias * DIA + ms);

  const cuenta = (rol: string = ROLES.CLIENTE) =>
    prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Marcela',
        apellido: 'Soto',
        email: `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`,
        contrasenaHash: 'sin-uso',
        rol,
        fechaVerificacionCorreo: new Date(),
      },
    });

  /** Solicitud con dos documentos adjuntos. */
  const solicitudConDocumentos = async (datos: {
    estado: string;
    fechaResolucion?: Date;
    resolutorId?: number;
    motivoRechazo?: string;
  }) => {
    const solicitante = await cuenta();
    const solicitud = await prisma.solicitudVerificacion.create({
      data: {
        solicitanteId: solicitante.id,
        fechaSolicitud: hace(60),
        fechaConsultaSii: hace(60),
        resultadoConsultaSii: 'otro_giro',
        girosSii: GIROS,
        proveedorConsultaSii: 'simulado',
        operacionConsultaSii: randomUUID(),
        ...datos,
      },
    });
    const documentos = await Promise.all(
      ['titulo', 'certificado'].map((tipo) =>
        prisma.antecedente.create({
          data: {
            solicitudId: solicitud.id,
            tipo,
            nombreArchivo: `${tipo}.pdf`,
            ubicacionArchivo: `verificaciones/${solicitante.id}/${randomUUID()}`,
            hashArchivo: 'b'.repeat(64),
            estadoOcr: 'no_aplica',
          },
        }),
      ),
    );
    return { solicitud, documentos };
  };

  const limpiar = async () => {
    await prisma.solicitudVerificacion.deleteMany({
      where: { solicitante: { email: { startsWith: PREFIJO_CORREO } } },
    });
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: PREFIJO_CORREO } },
    });
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AlmacenArchivos)
      .useValue(almacen)
      .compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    servicio = app.get(LimpiezaVerificacionService);
    await limpiar();
  });

  afterAll(async () => {
    await limpiar();
    await app.close();
  });

  it('E10-H6 · CA1 archivos eliminados: resuelta hace 30 días, elimina los archivos, conserva la solicitud con su resolución y la consulta al SII, y registra la fecha de eliminación', async () => {
    const resolutor = await cuenta(ROLES.ADMINISTRADOR);
    const rechazada = await solicitudConDocumentos({
      estado: ESTADOS_SOLICITUD.RECHAZADA,
      fechaResolucion: hace(30),
      resolutorId: resolutor.id,
      motivoRechazo: 'El certificado adjunto no es legible.',
    });
    const aprobada = await solicitudConDocumentos({
      estado: ESTADOS_SOLICITUD.APROBADA,
      fechaResolucion: hace(45),
      resolutorId: resolutor.id,
    });

    await servicio.eliminarArchivosVencidos(ahora);

    for (const { solicitud, documentos } of [rechazada, aprobada]) {
      for (const documento of documentos) {
        expect(almacen.eliminadas.has(documento.ubicacionArchivo)).toBe(true);
        const guardado = await prisma.antecedente.findUniqueOrThrow({
          where: { id: documento.id },
        });
        // Solo cambia la fecha de eliminación: tipo, nombre y hash se conservan
        expect(guardado).toEqual({
          ...documento,
          fechaEliminacionArchivo: expect.any(Date) as unknown,
        });
      }
      expect(
        await prisma.solicitudVerificacion.findUniqueOrThrow({
          where: { id: solicitud.id },
        }),
      ).toEqual(solicitud);
    }
  });

  it('E10-H6 · CA1: una pasada siguiente no vuelve a registrar la fecha de eliminación', async () => {
    const { documentos } = await solicitudConDocumentos({
      estado: ESTADOS_SOLICITUD.APROBADA,
      fechaResolucion: hace(31),
    });
    await servicio.eliminarArchivosVencidos(ahora);
    const primera = await prisma.antecedente.findUniqueOrThrow({
      where: { id: documentos[0].id },
    });

    await servicio.eliminarArchivosVencidos(new Date(ahora.getTime() + DIA));

    const segunda = await prisma.antecedente.findUniqueOrThrow({
      where: { id: documentos[0].id },
    });
    expect(primera.fechaEliminacionArchivo).not.toBeNull();
    expect(segunda.fechaEliminacionArchivo).toEqual(
      primera.fechaEliminacionArchivo,
    );
  });

  it('E10-H6 · CA2 solicitud reciente: resuelta hace menos de 30 días o sin resolver, conserva los archivos', async () => {
    const reciente = await solicitudConDocumentos({
      estado: ESTADOS_SOLICITUD.RECHAZADA,
      // Le falta un milisegundo para cumplir los 30 días
      fechaResolucion: hace(30, 1),
      motivoRechazo: 'El título adjunto está incompleto.',
    });
    const enRevision = await solicitudConDocumentos({
      estado: ESTADOS_SOLICITUD.REVISION_MANUAL,
    });
    const pendiente = await solicitudConDocumentos({
      estado: ESTADOS_SOLICITUD.PENDIENTE,
    });

    await servicio.eliminarArchivosVencidos(ahora);

    for (const { documentos } of [reciente, enRevision, pendiente]) {
      for (const documento of documentos) {
        expect(almacen.eliminadas.has(documento.ubicacionArchivo)).toBe(false);
        const guardado = await prisma.antecedente.findUniqueOrThrow({
          where: { id: documento.id },
        });
        expect(guardado.fechaEliminacionArchivo).toBeNull();
      }
    }
  });
});
