# Cabello Perfecto — Backend

API de la tienda online de Cabello Perfecto: NestJS 12 + Prisma 7 + PostgreSQL 17 + Redis 8
(BullMQ). Proyecto de título de Contrum-Projects.

## Requisitos

- Node.js 22 o superior y pnpm 10 (`corepack enable`)
- Docker con Docker Compose
- Para trabajar con Claude Code: [Claude Code](https://code.claude.com/docs/en/overview) y, para
  abrir PRs desde él, [GitHub CLI](https://cli.github.com/) con `gh auth login`

## Puesta en marcha

```bash
pnpm install                  # instala y genera el cliente de Prisma
cp .env.example .env          # completa los secretos JWT (openssl rand -base64 48)
docker compose up -d db redis # PostgreSQL y Redis
pnpm db:deploy                # aplica las migraciones
pnpm db:seed                  # 16 regiones y la cuenta admin de desarrollo
pnpm start:dev                # http://localhost:3000/api  ·  docs en /api/docs
```

La cuenta de desarrollo es `admin@cabelloperfecto.local` / `Cambiar.123456` (se cambian con
`SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD`). Solo para desarrollo.

Para levantar todo en contenedores, como en el servidor (RNF-24):

```bash
cp .env.example .env
docker compose up -d --build  # db, redis, migraciones y api
curl localhost:3000/api/salud
```

## Scripts

| Script | Qué hace |
| --- | --- |
| `pnpm verificar` | lint + formato + tipos + pruebas + build. Debe pasar antes de cada commit |
| `pnpm test` / `pnpm test:e2e` | Pruebas unitarias / e2e (las e2e necesitan db y redis) |
| `pnpm db:migrate --name <x>` | Crea y aplica una migración tras cambiar `prisma/schema.prisma` |
| `pnpm db:deploy` | Aplica migraciones pendientes |
| `pnpm db:seed` | Datos iniciales |
| `pnpm db:studio` | Explorador de la base |

## Flujo de trabajo

- Las historias están en Jira (proyecto **SCRUM**), en sprints quincenales con Scrumban.
- Una rama por historia: `SCRUM-<n>-<descripcion>`. Pull request a `main` revisado por otro
  integrante. CI corre lint, tipos, pruebas, migraciones, e2e, build y gitleaks.
- Commits: `feat(<modulo>): <qué hace> (SCRUM-<n>)`.

## Claude Code

El repositorio trae la configuración compartida en `CLAUDE.md`, `.claude/` y `.mcp.json`.

**Primera vez (cada integrante):**

1. Abre Claude Code en la carpeta del repositorio y acepta los servidores MCP del proyecto
   (Atlassian y Figma) cuando los pida.
2. Escribe `/mcp`, elige **atlassian** y luego **figma**, y autentícate con tu cuenta en cada uno.
3. Verifica con: «lee la historia SCRUM-19».

**Comandos:**

| Comando | Para qué |
| --- | --- |
| `/historia SCRUM-<n>` | Toma una historia: la lee en Jira, propone un plan, crea la rama, implementa con pruebas por criterio y verifica |
| `/migracion <nombre>` | Cambia el esquema de la base con su migración |
| `/pr` | Verifica, publica la rama, abre el PR con la plantilla y mueve la historia a En revisión |
| `/revisar [PR o rama]` | Revisión completa: código, seguridad y criterios de aceptación |

**Subagentes** (Claude los usa solo, o pídeselos por nombre): `revisor-codigo`,
`verificador-criterios` y `auditor-seguridad`.

**Protecciones:** Claude no puede leer `.env`, editar migraciones existentes ni código generado,
hacer push a `main`, `push --force` ni merge de PRs. Antes de `git push`, `gh pr create`,
cambios de estado en Jira o instalar dependencias, pide permiso. Cada archivo `.ts` que edita se
formatea con Prettier.

Tus preferencias personales van en `.claude/settings.local.json` y `CLAUDE.local.md`, que no se
versionan.

## Documentación

- `docs/reglas-de-negocio.md`: reglas por épica y requerimientos no funcionales.
- `src/modulos/README.md`: módulos de dominio y su épica.
- `prisma/schema.prisma`: el MER (39 entidades) en Prisma.
