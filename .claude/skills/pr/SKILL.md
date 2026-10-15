---
name: pr
description: Abre el pull request de la rama actual hacia main con la plantilla del proyecto, y mueve la historia de Jira a En revisión. Úsala cuando la historia está implementada y verificada.
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(pnpm verificar) Bash(gh pr view *) mcp__atlassian__getJiraIssue
---

# Abrir pull request

1. **Rama.** Confirma que no estás en `main` y que la rama se llama `SCRUM-<n>-...`. Saca la clave
   de Jira del nombre. Si hay cambios sin commit, muéstralos y pregunta qué hacer.
2. **Al día con main.** `git fetch origin main`. Si `main` avanzó, propone `git rebase origin/main`
   y resuelve conflictos con el usuario.
3. **Verificación.** Corre `pnpm verificar` (y `pnpm test:e2e` si la rama toca base de datos o
   permisos). Si algo falla, detente y arréglalo antes de seguir.
4. **Descripción.** Lee la historia en Jira y llena `.github/pull_request_template.md`:
   - Título: `SCRUM-<n> <resumen de la historia>`.
   - Cada criterio de aceptación con la prueba que lo comprueba (`archivo › nombre del test`).
   - RF y RNF que toca; migraciones incluidas; variables nuevas de `.env.example`.
   - Lo pendiente o las decisiones que el revisor debe validar.
   Muestra la descripción al usuario antes de publicar.
5. **Publicar** (cada paso pide permiso):
   - `git push -u origin <rama>`
   - `gh pr create --base main --title "<título>" --body-file <archivo temporal>`
   Si `gh` no está instalado o no tiene sesión, entrega el título y la descripción para que el
   usuario los pegue en GitHub.
6. **Jira.** Ofrece mover la historia a **En revisión** y agregar un comentario con el enlace al PR.
7. Recuerda que el PR lo revisa y lo integra otro integrante del equipo; tú no haces merge.
