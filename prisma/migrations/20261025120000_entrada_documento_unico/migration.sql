-- DropIndex
DROP INDEX "entrada_inventario_id_proveedor_idx";

-- CreateIndex
CREATE UNIQUE INDEX "entrada_inventario_id_proveedor_tipo_documento_proveedor_nu_key" ON "entrada_inventario"("id_proveedor", "tipo_documento_proveedor", "numero_documento_proveedor");
