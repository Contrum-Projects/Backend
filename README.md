# Cabello Perfecto — Backend

API REST de la tienda online de Cabello Perfecto, una tienda de productos capilares que vende a
público general y a peluqueros profesionales. Esta API entrega el catálogo con precio minorista o
mayorista según el rol, el carrito y la compra, el pago con Mercado Pago, el despacho con
Chilexpress, el inventario, la verificación de peluqueros y el marketing por correo. Es el
proyecto de título del equipo Contrum-Projects.

La tienda y el panel de administración están en el repositorio
[Frontend](https://github.com/Contrum-Projects/Frontend).

## Funcionalidades

| Módulo | Qué cubre |
| --- | --- |
| `cuentas` | Registro, confirmación de correo, inicio y cierre de sesión, recuperación de contraseña, datos y direcciones |
| `personal` | Cuentas del personal de tienda, roles fijos y control de acceso |
| `catalogo` | Catálogo público, búsqueda, productos, formatos, packs, marcas y categorías; descripción sugerida con IA |
| `carrito`, `pedidos` | Carrito, compra, estados e historial del pedido |
| `pagos` | Mercado Pago: preferencia de pago, webhook y conciliación |
| `despacho` | Retiro en tienda, cotización y envío con Chilexpress (OT automática) |
| `facturacion` | Datos de facturación y documentos tributarios |
| `verificacion` | Verificación de peluqueros: consulta al SII (Khipu) y revisión de antecedentes |
| `inventario` | Bodegas, ubicaciones, proveedores, entradas, salidas, ajustes y movimientos |
| `marketing`, `cupones`, `portada` | Suscripciones, campañas, carritos abandonados, cupones y slides de la portada |
| `reportes` | Indicadores del panel (objetivos OE1 a OE3) y exportación de ventas |
| `notificaciones`, `territorio` | Cola de correos y su envío; regiones y comunas de Chile |

El detalle de cada módulo y su épica está en [`src/modulos/README.md`](src/modulos/README.md).

## Stack

| Pieza | Uso |
| --- | --- |
| Node.js 22, TypeScript 6 (ESM) | Lenguaje y entorno |
| NestJS 12 | Módulos, controladores, servicios y guards |
| Prisma 7 + PostgreSQL 17 | Modelo de datos (45 modelos) y migraciones |
| Redis 8 + BullMQ | Colas de correo, plazos de pago, límites de intentos, revocación de sesiones y caché |
| JWT + argon2 | Token de acceso en memoria, token de refresco en cookie `httpOnly`, hash de contraseñas |
| Swagger | Documentación de la API en `/api/docs` (fuera de producción) |
| Vitest + Supertest | Pruebas unitarias y e2e contra PostgreSQL y Redis reales |
| oxlint, Prettier, gitleaks | Calidad y revisión de secretos en la CI |

Servicios externos: Mercado Pago, Chilexpress, Resend (correos), Cloudflare R2 (imágenes),
Khipu (consulta al SII) y Gemini/Groq (descripción sugerida desde la foto del producto). Todos son
opcionales en desarrollo: sin sus claves, la API arranca y la ruta que los usa responde 503.

## Requisitos

- Node.js 22 o superior y pnpm 10 (`corepack enable`)
- Docker con Docker Compose

## Puesta en marcha (desarrollo)

```bash
pnpm install                  # instala y genera el cliente de Prisma
cp .env.example .env          # completa los secretos JWT (openssl rand -base64 48)
docker compose up -d db redis # PostgreSQL y Redis
pnpm db:deploy                # aplica las migraciones
pnpm db:seed                  # regiones, comunas, bodegas de prueba y la cuenta admin
pnpm start:dev                # http://localhost:3000/api  ·  docs en /api/docs
```

La cuenta de desarrollo es `admin@cabelloperfecto.local` / `Cambiar.123456` (se cambia con
`SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD`). Solo para desarrollo.

Para ver la tienda, levanta además el [frontend](https://github.com/Contrum-Projects/Frontend) en
`http://localhost:3001`. El navegador habla solo con Next, que reenvía `/api` a esta API.

Comprueba que la API responde con `curl localhost:3000/api/salud`.

## Variables de entorno

Todas están en [`.env.example`](.env.example) con su explicación, y se validan al arrancar
(`src/config/entorno.ts`). Con `docker compose`, los valores de ejemplo ya funcionan para
desarrollar.

| Grupo | Variables | Obligatorias |
| --- | --- | --- |
| App | `NODE_ENV`, `PORT`, `CORS_ORIGINS`, `PROXIES_CONFIABLES` | Sí |
| Datos | `DATABASE_URL`, `REDIS_URL`, `POSTGRES_*` | Sí |
| Sesión | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` y sus duraciones | Sí |
| Enlaces | `URL_TIENDA` (enlaces de los correos), `URL_API` (seguimiento de la publicidad) | `URL_TIENDA` |
| Reglas de negocio | `IVA_PORCENTAJE`, `PLAZO_PAGO_MINUTOS`, duración de los enlaces de correo | Con valores por defecto |
| Correo | `RESEND_API_KEY`, `CORREO_REMITENTE`, `RESEND_WEBHOOK_SECRET` | `RESEND_API_KEY` en producción |
| Integraciones | `MERCADOPAGO_*`, `CHILEXPRESS_*`, `R2_*`, `KHIPU_*`, `GEMINI_*`, `GROQ_*` | No |

Nunca subas `.env` al repositorio (RNF-10): las credenciales van solo en el entorno.

## Base de datos

- El modelo está en [`prisma/schema.prisma`](prisma/schema.prisma), con los nombres de tablas y
  columnas del MER.
- Las migraciones están en `prisma/migrations/`. Para cambiar el esquema, edita `schema.prisma` y
  corre `pnpm db:migrate --name <descripcion>`. No se edita una migración existente.
- Para obtener el script SQL completo del esquema sin levantar la base:

  ```bash
  pnpm prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > esquema.sql
  ```

- `pnpm db:seed` es idempotente: carga las 16 regiones y 346 comunas, la cuenta de administrador
  y, fuera de producción, dos bodegas de prueba.

## Scripts

| Script | Qué hace |
| --- | --- |
| `pnpm start:dev` | API en modo desarrollo, con recarga |
| `pnpm verificar` | Lint, formato, tipos, pruebas y build. Debe pasar antes de cada commit |
| `pnpm test` / `pnpm test:e2e` | Pruebas unitarias / e2e (las e2e necesitan db y redis) |
| `pnpm db:migrate --name <x>` | Crea y aplica una migración tras cambiar `prisma/schema.prisma` |
| `pnpm db:deploy` | Aplica las migraciones pendientes |
| `pnpm db:seed` | Datos iniciales |
| `pnpm db:studio` | Explorador de la base |

## Pruebas

- Unitarias (`src/**/*.spec.ts`): servicios con Prisma simulado.
- e2e (`test/*.e2e-spec.ts`): flujos completos, permisos (401/403) y transacciones contra
  PostgreSQL y Redis reales. Levanta antes `docker compose up -d db redis`.
- Cada criterio de aceptación tiene al menos una prueba, y su nombre cita el criterio
  (`E1-H1 · correo o RUT ya registrado: no crea la cuenta`).
- La CI de GitHub Actions corre lint, tipos, pruebas, migraciones, e2e, build y gitleaks en cada
  pull request.

## Despliegue

- **Todo en contenedores, en local** (RNF-24): `docker compose up -d --build` levanta db, redis,
  las migraciones y la API en modo producción. Antes completa `RESEND_API_KEY` en `.env`, o la
  API no arranca.
- **Servidor (VPS)**: [`despliegue/README.md`](despliegue/README.md) explica cómo levantar la
  base, Redis, la API y la tienda con Docker y nginx en un solo subdominio con HTTPS, y cómo
  configurar Resend, Mercado Pago, Chilexpress y Khipu en modo de prueba.

Para actualizar el servidor después de un merge a `main`:

```bash
cd ~/cabello-perfecto/cp-backend && git pull
cd despliegue && docker compose build api && docker compose up -d
```

### Seguimiento de los correos publicitarios (E12-H6)

Las aperturas, los clics y los rebotes de la publicidad necesitan dos pasos por ambiente, fuera
del código. Sin ellos la API funciona igual: los correos salen sin seguimiento y los rebotes no se
registran.

1. **`URL_API` en `.env`**: la dirección pública de esta API, sin `/api` (en local
   `http://localhost:3000`). La imagen de apertura y los enlaces de clic apuntan ahí.
2. **Webhook en Resend** (Webhooks → Add endpoint): URL `<URL_API>/api/marketing/rebotes`,
   evento `email.bounced`. Copia el *signing secret* (`whsec_…`) a `RESEND_WEBHOOK_SECRET`. Sin
   él, la ruta responde 503. En local, Resend no llega sin un túnel (por ejemplo ngrok).

## Estructura

```
src/
  main.ts, configurar-app.ts   # arranque, prefijo /api y validación global
  config/entorno.ts            # variables de entorno validadas con zod
  common/dominio/              # roles, permisos, estados y cálculo de montos
  modulos/<modulo>/            # un módulo por área del negocio
  prisma/, redis/, colas/      # acceso a datos, Redis y colas BullMQ
  salud/                       # GET /api/salud
prisma/                        # schema.prisma, migraciones y semilla
test/                          # pruebas e2e
despliegue/                    # docker compose y nginx del servidor
docs/reglas-de-negocio.md      # reglas por épica y requerimientos no funcionales
```

## Flujo de trabajo

- Las historias están en Jira (proyecto **SCRUM**), en sprints quincenales con Scrumban.
- Una rama por historia desde `main`: `SCRUM-<n>-<descripcion>`. Pull request a `main` revisado
  por otro integrante. Nadie hace push directo a `main`.
- Commits en español con Conventional Commits y la clave: `feat(<modulo>): <qué hace> (SCRUM-<n>)`.

## Claude Code

El repositorio trae la configuración compartida en `CLAUDE.md`, `.claude/` y `.mcp.json`.

**Primera vez (cada integrante):** abre Claude Code en la carpeta del repositorio, acepta los
servidores MCP del proyecto (Atlassian y Figma), autentícate en cada uno con `/mcp` y verifica con
«lee la historia SCRUM-19».

| Comando | Para qué |
| --- | --- |
| `/historia SCRUM-<n>` | Toma una historia: la lee en Jira, propone un plan, crea la rama, implementa con pruebas por criterio y verifica |
| `/migracion <nombre>` | Cambia el esquema de la base con su migración |
| `/pr` | Verifica, publica la rama, abre el PR con la plantilla y mueve la historia a En revisión |
| `/revisar [PR o rama]` | Revisión completa: código, seguridad y criterios de aceptación |

Subagentes: `revisor-codigo`, `verificador-criterios` y `auditor-seguridad`.

**Protecciones:** Claude no puede leer `.env`, editar migraciones existentes ni código generado,
hacer push a `main`, `push --force` ni merge de PRs. Pide permiso antes de `git push`,
`gh pr create`, cambios de estado en Jira o instalar dependencias. Las preferencias personales van
en `.claude/settings.local.json` y `CLAUDE.local.md`, que no se versionan.

## Documentación

- [`docs/reglas-de-negocio.md`](docs/reglas-de-negocio.md): reglas por épica y requerimientos no
  funcionales.
- [`src/modulos/README.md`](src/modulos/README.md): módulos de dominio y su épica.
- [`despliegue/README.md`](despliegue/README.md): despliegue en el servidor.
- `/api/docs`: Swagger con todos los endpoints (con la API corriendo en desarrollo).
