---
name: historia
description: Empieza a trabajar una historia de usuario de Jira (SCRUM-n) de punta a punta - la lee, planifica, crea la rama, implementa con pruebas por criterio y verifica. Úsala cuando el usuario diga "tomemos SCRUM-19", "implementa la historia E1-H1" o similar.
argument-hint: SCRUM-<n>
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(pnpm *) mcp__atlassian__getJiraIssue mcp__atlassian__searchJiraIssuesUsingJql
---

# Historia $ARGUMENTS

Trabaja la historia **$ARGUMENTS** siguiendo estos pasos en orden. Si el argumento viene vacío,
pregunta qué historia tomar y sugiere la siguiente del sprint activo:
`project = SCRUM AND sprint in openSprints() AND statusCategory = "To Do" ORDER BY Rank ASC`.

## 1. Leer la historia

- Lee la incidencia con el conector de Jira (`getJiraIssue`, cloudId
  `bc9de2c3-63ac-4379-8782-8b69ef593475`): resumen, descripción completa (criterios de aceptación y
  RF), puntos (`customfield_10016`), épica padre y estado.
- Si el conector no responde, pide al usuario que pegue la historia; no sigas de memoria.
- Si la historia está bloqueada por otra (dependencia de épica) o ya está En curso con otra persona,
  avísalo y pregunta antes de seguir.

## 2. Entender el contexto

- Lee la sección de su épica y las reglas transversales en `docs/reglas-de-negocio.md`.
- Revisa los modelos de `prisma/schema.prisma` que toca y el código existente del módulo
  (`src/modulos/<modulo>/`, ver `src/modulos/README.md`).
- Lista lo que la historia no define o está PENDIENTE. **Pregunta antes de implementar** cualquier
  regla, valor o estado que no esté en la historia ni en los documentos.

## 3. Plan

Presenta un plan corto y espera la aprobación del usuario:
- Criterio de aceptación → qué endpoint/servicio lo cumple → qué prueba lo comprueba.
- Endpoints (método, ruta, rol requerido, DTO de entrada, respuesta).
- Cambios al esquema (si hay, se harán con `/migracion`).
- Variables de entorno nuevas, colas o dependencias nuevas (justificadas).

## 4. Rama y Jira

- `git fetch origin && git switch main && git pull --ff-only origin main`
- `git switch -c SCRUM-<n>-<descripcion-corta-en-kebab-case>`
- Ofrece mover la historia a **En curso** en Jira (pide confirmación; el cambio lo ve todo el equipo).

## 5. Implementar

- Sigue las reglas de `CLAUDE.md`: capas, transacciones (RNF-12), stock atómico (RNF-13),
  autorización en el backend (RNF-03), sin mayorista para quien no corresponde (RNF-04),
  `codigoPublico` en URLs (RNF-07), Redis tolerante a fallas (RNF-32).
- Escribe primero las pruebas de cada criterio (nombre del test con el ID de la historia y el
  criterio), luego el código hasta que pasen.
- Si un módulo es nuevo, regístralo en `src/app.module.ts`.

## 6. Verificar

- `pnpm verificar`; si tocaste base de datos o permisos, además `pnpm test:e2e`
  (con `docker compose up -d db redis`).
- Pide al subagente **verificador-criterios** que compare la historia con la implementación y las
  pruebas. Corrige lo que marque como no cumplido.
- Si la historia toca autenticación, permisos, pagos, precios o datos personales, pide también al
  subagente **auditor-seguridad** que revise el diff.

## 7. Commit

- Commits pequeños en español: `feat(<modulo>): <qué hace> (SCRUM-<n>)`.
- Termina con un resumen: criterios cumplidos (con su prueba), decisiones tomadas, lo que quedó
  pendiente o por preguntar, y sugiere `/pr` para abrir el pull request.
