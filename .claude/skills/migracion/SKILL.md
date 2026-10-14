---
name: migracion
description: Cambia el esquema de base de datos de forma segura - edita schema.prisma, crea la migración con Prisma, revisa el SQL y regenera el cliente. Úsala siempre que una historia necesite tablas, columnas, índices o restricciones nuevas.
argument-hint: <nombre_en_snake_case>
allowed-tools: Bash(pnpm db:migrate *) Bash(pnpm prisma validate) Bash(pnpm prisma format) Bash(pnpm prisma migrate status) Bash(pnpm db:generate) Bash(docker compose up -d db redis)
---

# Migración $ARGUMENTS

1. **Antes de tocar el esquema:** explica el cambio y por qué la historia lo necesita. Si cambia
   el MER (entidad, relación o atributo nuevo), dilo explícitamente: el equipo debe actualizar sus
   documentos. Espera la confirmación del usuario.
2. **Base arriba:** `docker compose up -d db redis` y `pnpm prisma migrate status` (no debe haber
   migraciones pendientes ni divergentes; si las hay, detente y avisa).
3. **Editar `prisma/schema.prisma`** respetando las convenciones del archivo:
   - modelo en PascalCase y `@@map("snake_case")`; campos en camelCase con `@map` al nombre del MER;
   - `@db.Timestamptz(6)` para fechas con hora, `@db.Date` para fechas, `@db.Decimal(12, 2)` para
     precios netos, `Int` para montos en pesos del pedido;
   - `@@index` en cada clave foránea que se consulte;
   - estados y tipos como `String` con su lista en `src/common/dominio/valores.ts`.
4. `pnpm prisma format && pnpm prisma validate`.
5. **Crear la migración:** `pnpm db:migrate --name $ARGUMENTS`.
6. **Revisar el SQL generado** en `prisma/migrations/<fecha>_$ARGUMENTS/migration.sql`:
   - ¿borra o reescribe columnas con datos (`DROP`, cambio de tipo)? Avísalo como riesgo;
   - una columna `NOT NULL` nueva en una tabla con datos necesita valor por defecto o migración
     en dos pasos;
   - nada fuera de lo pedido.
   Si algo está mal y la migración **todavía no está en `main`**: corrige el esquema, pide al
   usuario que borre la carpeta de esa migración y que autorice `pnpm db:reset` (borra los datos
   locales y reaplica todo), y vuelve al paso 5. Si ya está en `main`, no se toca: crea otra
   migración que corrija. Nunca edites migraciones existentes.
7. `pnpm db:generate` y `pnpm verificar`.
8. Commit separado: `feat(db): <qué cambia> (SCRUM-<n>)`.
