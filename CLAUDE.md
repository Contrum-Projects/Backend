# Cabello Perfecto — Backend

API REST de la tienda online de Cabello Perfecto (productos capilares): catálogo con precio
minorista y mayorista según el rol, carrito y compra, pago con Mercado Pago, despacho con Blue
Express, inventario, verificación de peluqueros y marketing por correo. Proyecto de título del
equipo Contrum-Projects (3 integrantes), con Scrumban y sprints quincenales en Jira.

**Idioma:** responde, comenta y nombra en español. Identificadores sin tildes ni ñ
(`campana`, `anosExperiencia`); textos para personas, con tildes.

## Antes de implementar

1. La historia (con sus criterios de aceptación) está en Jira, proyecto **SCRUM**. Léela entera.
2. Lee la sección de su épica en `docs/reglas-de-negocio.md`. Ahí también están las reglas
   transversales (seguridad, montos, transacciones).
3. Si algo está marcado PENDIENTE o la historia no lo define, **pregunta**: no inventes reglas de
   negocio, valores ni listas de estados.

## Stack

| Pieza | Uso |
| --- | --- |
| Node 22, TypeScript 6, ESM (`"type": "module"`) | Imports relativos **con extensión `.js`** |
| NestJS 12 | Módulos, controladores, servicios, guards |
| Prisma 7 + PostgreSQL 17 | `prisma/schema.prisma`; cliente generado en `src/generated/prisma` (no se versiona) |
| Redis 8 + BullMQ (`@nestjs/bullmq`) | Colas, plazos, límites, revocación, caché. Nunca datos del negocio |
| class-validator / class-transformer | DTOs de entrada con los validadores de `src/common/validacion` (mensajes en español); `ValidationPipe` global con `whitelist` y `forbidNonWhitelisted` |
| zod | Solo para validar el entorno (`src/config/entorno.ts`) |
| @nestjs/jwt + argon2 | Tokens de acceso y hash de contraseñas y tokens |
| @nestjs/throttler | Límites de RNF-09, con el contador en Redis (`src/limites/almacen-limites-redis.ts`) |
| @nestjs/swagger | Documentación en `/api/docs` (fuera de producción) |
| nestjs-pino | Logs; nunca registres contraseñas, tokens ni cuerpos con datos personales |
| Vitest + Supertest | Pruebas unitarias (`*.spec.ts`) y e2e (`test/*.e2e-spec.ts`) |
| oxlint + Prettier | Lint y formato |

## Comandos

```bash
docker compose up -d db redis     # base y Redis para desarrollar
pnpm start:dev                    # API en http://localhost:3000/api (docs en /api/docs)
pnpm verificar                    # lint + formato + tipos + pruebas + build: debe pasar antes de cada commit
pnpm test                         # unitarias;  pnpm test -- montos  para filtrar
pnpm test:e2e                     # e2e (requiere db y redis arriba)
pnpm db:migrate --name <nombre>   # crea y aplica una migración tras cambiar schema.prisma
pnpm db:seed                      # regiones y cuenta admin de desarrollo
pnpm db:studio                    # explorar la base
```

## Estructura

```
src/
  main.ts, configurar-app.ts   # arranque; prefijo /api y ValidationPipe (también los usan los e2e)
  app.module.ts                # registra los módulos de dominio
  config/entorno.ts            # variables de entorno validadas; agrega aquí cada variable nueva y en .env.example
  prisma/                      # PrismaService (global)
  redis/                       # cliente Redis (token REDIS, global)
  colas/colas.ts               # nombres de colas y prioridades de correo
  common/dominio/              # roles, valores permitidos de estados/tipos, cálculo de montos
  modulos/<modulo>/            # un módulo por área; ver src/modulos/README.md
  salud/                       # GET /api/salud
prisma/schema.prisma           # 39 modelos del MER; migraciones en prisma/migrations
docs/reglas-de-negocio.md      # reglas por épica y requerimientos no funcionales
```

## Reglas de arquitectura

- **Capas:** el controlador valida (DTO) y delega; la lógica y las transacciones viven en el
  servicio; el acceso a datos usa `PrismaService`. Sin lógica de negocio en controladores.
- **Transacciones (RNF-12):** dato + su historia en `prisma.$transaction(async (tx) => ...)`:
  pedido + historial, stock + movimiento, cambio + NOTIFICACION. Encola el trabajo en BullMQ
  **después** del commit, nunca dentro.
- **Stock (RNF-13):** nunca leer-y-luego-escribir; descuenta con condición atómica
  (`updateMany({ where: { cantidad: { gte: n } } })` y verifica `count`) o bloqueo de fila.
- **Redis puede caer (RNF-32):** catálogo, carrito, compra y pago no deben fallar si Redis no
  responde. Envuelve los usos de Redis con manejo de error; la caché nunca guarda precios, stock
  ni datos de cuentas.
- **Sin estado en memoria (RNF-20):** nada de mapas en memoria ni `setInterval`; tareas
  programadas con jobs repetibles de BullMQ.
- **Autorización en el backend (RNF-03):** cada ruta del panel lleva guard de JWT y de rol. Toda
  respuesta que pueda incluir precios pasa por la lógica que oculta el mayorista (RNF-04).
- **URLs con `codigoPublico`** (UUID para usuario, código de 12 caracteres para pedido), nunca el id.
- **Montos:** precios netos `Decimal`; montos del pedido en pesos enteros; usa `calcularMontos()`.
- **Estados y tipos:** usa las constantes de `src/common/dominio/valores.ts` y `roles.ts`; si
  falta una lista, pregunta antes de crearla.
- **Errores:** excepciones de NestJS (`BadRequestException`, `ConflictException`,
  `NotFoundException`, `ForbiddenException`) con mensajes en español para el usuario.
- **Documenta** cada endpoint con `@ApiTags` y `@ApiOperation`.

## Base de datos

- Cambios de esquema: edita `prisma/schema.prisma` y crea la migración con
  `pnpm db:migrate --name <descripcion_en_snake_case>`. Revisa el SQL generado.
- **Nunca edites una migración ya existente**; crea una nueva. Nunca uses `prisma db push`.
- Mantén las convenciones del esquema: modelos en PascalCase, `@map` a snake_case igual al MER.
- Si el cambio altera el MER, avísalo para actualizar los documentos del equipo.

## Pruebas

- Cada criterio de aceptación de la historia tiene al menos una prueba, y el nombre del test cita
  el criterio: `it('E1-H1 · correo o RUT ya registrado: no crea la cuenta', ...)`.
- Servicios: pruebas unitarias con Prisma simulado. Flujos con base de datos, permisos (401/403) y
  transacciones: e2e contra PostgreSQL y Redis reales.
- Corre `pnpm verificar` (y `pnpm test:e2e` si tocaste flujos con base de datos) antes de cada
  commit. No marques nada como listo si falla.

## Flujo de trabajo (Scrumban)

- Jira: sitio Contrum Projects, proyecto **SCRUM**, cloudId `bc9de2c3-63ac-4379-8782-8b69ef593475`.
  Columnas: Por hacer → En curso → En revisión → Finalizado. Puntos en `customfield_10016`,
  sprint en `customfield_10020`. Respeta el límite de trabajo en curso: una historia a la vez.
- Una rama corta por historia desde `main`: `SCRUM-<n>-<descripcion-corta>` (ej.
  `SCRUM-19-registro-cuenta`). Vuelve a `main` con un pull request revisado por otro integrante.
- Commits en español con Conventional Commits y la clave de Jira:
  `feat(cuentas): registrar cuenta y enviar confirmación (SCRUM-19)`.
- Nunca hagas push a `main`, `push --force`, ni merge de PR: eso lo hace el equipo.
- Comandos del proyecto: `/historia SCRUM-<n>` para empezar una historia, `/pr` para abrir el PR,
  `/revisar` para revisar una rama, `/migracion <nombre>` para cambiar el esquema.
- Los commits y PRs son del integrante que los firma: no agregues `Co-Authored-By`,
  `Claude-Session`, «Generated with Claude Code» ni ninguna otra mención a Claude en mensajes de
  commit ni en descripciones de PR.

## No hacer

- No leas ni edites `.env` (credenciales). Las variables nuevas van en `src/config/entorno.ts` y
  `.env.example`.
- No edites `src/generated/` (lo genera `prisma generate`).
- No agregues dependencias sin decirlo y justificarlo.
- No guardes datos de tarjetas, contraseñas ni tokens en texto plano, ni los registres en logs.
