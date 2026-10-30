-- AlterTable
ALTER TABLE "pedido" ADD COLUMN     "clave_idempotencia" VARCHAR(36);

-- CreateIndex
CREATE UNIQUE INDEX "pedido_id_usuario_clave_idempotencia_key" ON "pedido"("id_usuario", "clave_idempotencia");

