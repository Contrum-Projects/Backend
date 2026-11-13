-- AlterTable
ALTER TABLE "bodega" ADD COLUMN     "es_despacho" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "envio" ADD COLUMN     "codigo_servicio" INTEGER,
ADD COLUMN     "etiqueta" TEXT;

-- Una sola bodega de despacho (SCRUM-153): Prisma no declara índices parciales
CREATE UNIQUE INDEX "bodega_una_de_despacho" ON "bodega" ("es_despacho") WHERE "es_despacho";
