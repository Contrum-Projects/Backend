import type { ConfigService } from '@nestjs/config';
import { TRABAJOS_CORREO } from '../../colas/colas.js';
import { ROLES } from '../../common/dominio/roles.js';
import type { Entorno } from '../../config/entorno.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ContenidoCorreosService } from './contenido-correos.service.js';

const MOTIVO = 'Dejó de ejercer como peluquera según nos informó.';

describe('ContenidoCorreosService', () => {
  const crear = () => {
    const prisma = {
      historialRol: {
        findFirstOrThrow: vi.fn().mockResolvedValue({ motivo: MOTIVO }),
      },
    };
    const config = {
      get: () => 'https://tienda.cl/',
    } as unknown as ConfigService<Entorno, true>;
    return {
      prisma,
      servicio: new ContenidoCorreosService(
        prisma as unknown as PrismaService,
        config,
      ),
    };
  };

  it('E13-H3 · profesional que vuelve a cliente: el correo lleva el motivo del último cambio de profesional a cliente de esa cuenta', async () => {
    const { prisma, servicio } = crear();

    const { html, texto } = await servicio.construir(
      TRABAJOS_CORREO.ROL_PROFESIONAL_RETIRADO,
      { notificacionId: 9, destinatario: 'andrea@correo.cl', nombre: 'Andrea' },
      {
        asunto: 'Tu cuenta volvió a ser de cliente',
        pedidoId: null,
        usuarioId: 20,
      },
    );

    expect(prisma.historialRol.findFirstOrThrow).toHaveBeenCalledWith({
      where: {
        usuarioId: 20,
        rolAnterior: ROLES.PROFESIONAL,
        rolNuevo: ROLES.CLIENTE,
      },
      select: { motivo: true },
      orderBy: { id: 'desc' },
    });
    expect(html).toContain(MOTIVO);
    expect(html).toContain('Hola, Andrea.');
    expect(texto).toContain(`Motivo: ${MOTIVO}`);
    expect(texto).toContain('https://tienda.cl/catalogo');
  });
});
