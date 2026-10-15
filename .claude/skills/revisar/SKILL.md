---
name: revisar
description: Revisa una rama o un pull request contra main - calidad, reglas del proyecto, seguridad y criterios de aceptación. Úsala para revisar el PR de un compañero o tu propia rama antes del PR.
argument-hint: "[número de PR o nombre de rama; vacío = rama actual]"
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(gh pr view *) Bash(gh pr diff *) Bash(gh pr checks *) Bash(pnpm verificar) Bash(pnpm test *) mcp__atlassian__getJiraIssue
---

# Revisión de $ARGUMENTS

1. **Obtener el cambio.**
   - Número de PR: `gh pr view $ARGUMENTS` y `gh pr diff $ARGUMENTS`; estado de CI con
     `gh pr checks $ARGUMENTS`.
   - Nombre de rama: `git fetch origin <rama>` y `git diff origin/main...origin/<rama>`.
   - Vacío: la rama actual contra `origin/main`.
2. **Historia.** Saca la clave `SCRUM-<n>` del nombre de la rama o del título y lee la historia en
   Jira para tener los criterios de aceptación.
3. **Revisión en paralelo.** Lanza a la vez:
   - subagente **revisor-codigo** sobre el diff;
   - subagente **auditor-seguridad** sobre el diff;
   - subagente **verificador-criterios** con la historia y la rama.
4. **Informe.** Junta los tres resultados en un solo informe, sin repetir hallazgos:
   - **Bloqueantes** (no se puede integrar), **Importantes**, **Sugerencias**.
   - Cada hallazgo con `archivo:línea`, el problema y la corrección propuesta.
   - Tabla de criterios de aceptación: cumple / no cumple / sin prueba.
   - Veredicto: aprobar, aprobar con cambios o pedir cambios.
5. No publiques comentarios en GitHub ni cambies código salvo que el usuario lo pida.
