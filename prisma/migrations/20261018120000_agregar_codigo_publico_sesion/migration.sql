-- AlterTable
ALTER TABLE "sesion" ADD COLUMN     "codigo_publico" VARCHAR(36) NOT NULL DEFAULT (gen_random_uuid())::text;

-- CreateIndex
CREATE UNIQUE INDEX "sesion_codigo_publico_key" ON "sesion"("codigo_publico");
