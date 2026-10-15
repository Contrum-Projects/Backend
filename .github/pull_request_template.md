## Historia

SCRUM-XX — <!-- título de la historia en Jira -->

## Qué cambia

<!-- 2 a 4 líneas: qué hace ahora el sistema que antes no hacía -->

## Criterios de aceptación

<!-- Copia los criterios de la historia y marca cómo se comprueba cada uno -->

- [ ] Criterio 1 — prueba: `archivo.spec.ts › nombre del test`
- [ ] Criterio 2 — prueba: …

## Requerimientos que toca

<!-- RF y RNF, p. ej. RF-01.01, RNF-01 -->

## Lista de revisión

- [ ] `pnpm verificar` pasa en local
- [ ] Si cambió el esquema: incluye la migración y no edita migraciones ya aplicadas
- [ ] Sin credenciales ni `.env` en el diff
- [ ] Los permisos se validan en el backend (RNF-03) y no se expone precio mayorista a quien no corresponde (RNF-04)
- [ ] Revisado por otro integrante del equipo
