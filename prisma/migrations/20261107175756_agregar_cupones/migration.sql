-- AlterTable
ALTER TABLE "pedido" ADD COLUMN     "id_cupon" INTEGER,
ADD COLUMN     "monto_descuento" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "cupon" (
    "id_cupon" SERIAL NOT NULL,
    "codigo" VARCHAR(30) NOT NULL,
    "descripcion" VARCHAR(200),
    "tipo_descuento" VARCHAR(30) NOT NULL,
    "valor" INTEGER NOT NULL,
    "tope_descuento" INTEGER,
    "alcance" VARCHAR(30) NOT NULL,
    "compra_minima" INTEGER,
    "fecha_inicio" TIMESTAMPTZ(6),
    "fecha_fin" TIMESTAMPTZ(6),
    "usos_maximos" INTEGER,
    "usos_por_cuenta" INTEGER,
    "incluye_profesionales" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "id_campana" INTEGER,
    "id_usuario" INTEGER NOT NULL,
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cupon_pkey" PRIMARY KEY ("id_cupon")
);

-- CreateTable
CREATE TABLE "cupon_articulo" (
    "id_cupon" INTEGER NOT NULL,
    "id_articulo" INTEGER NOT NULL,

    CONSTRAINT "cupon_articulo_pkey" PRIMARY KEY ("id_cupon","id_articulo")
);

-- CreateTable
CREATE TABLE "cupon_categoria" (
    "id_cupon" INTEGER NOT NULL,
    "id_categoria" INTEGER NOT NULL,

    CONSTRAINT "cupon_categoria_pkey" PRIMARY KEY ("id_cupon","id_categoria")
);

-- CreateTable
CREATE TABLE "cupon_marca" (
    "id_cupon" INTEGER NOT NULL,
    "id_marca" INTEGER NOT NULL,

    CONSTRAINT "cupon_marca_pkey" PRIMARY KEY ("id_cupon","id_marca")
);

-- CreateIndex
CREATE UNIQUE INDEX "cupon_codigo_key" ON "cupon"("codigo");

-- CreateIndex
CREATE INDEX "cupon_id_campana_idx" ON "cupon"("id_campana");

-- CreateIndex
CREATE INDEX "pedido_id_cupon_idx" ON "pedido"("id_cupon");

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_id_cupon_fkey" FOREIGN KEY ("id_cupon") REFERENCES "cupon"("id_cupon") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cupon" ADD CONSTRAINT "cupon_id_campana_fkey" FOREIGN KEY ("id_campana") REFERENCES "campana"("id_campana") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cupon" ADD CONSTRAINT "cupon_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cupon_articulo" ADD CONSTRAINT "cupon_articulo_id_cupon_fkey" FOREIGN KEY ("id_cupon") REFERENCES "cupon"("id_cupon") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cupon_articulo" ADD CONSTRAINT "cupon_articulo_id_articulo_fkey" FOREIGN KEY ("id_articulo") REFERENCES "articulo_venta"("id_articulo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cupon_categoria" ADD CONSTRAINT "cupon_categoria_id_cupon_fkey" FOREIGN KEY ("id_cupon") REFERENCES "cupon"("id_cupon") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cupon_categoria" ADD CONSTRAINT "cupon_categoria_id_categoria_fkey" FOREIGN KEY ("id_categoria") REFERENCES "categoria"("id_categoria") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cupon_marca" ADD CONSTRAINT "cupon_marca_id_cupon_fkey" FOREIGN KEY ("id_cupon") REFERENCES "cupon"("id_cupon") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cupon_marca" ADD CONSTRAINT "cupon_marca_id_marca_fkey" FOREIGN KEY ("id_marca") REFERENCES "marca"("id_marca") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas que Prisma no declara (SCRUM-150): respaldo de las validaciones del DTO
ALTER TABLE "cupon" ADD CONSTRAINT "cupon_valor_check" CHECK (
  "valor" > 0 AND ("tipo_descuento" <> 'porcentaje' OR "valor" <= 100)
);
ALTER TABLE "cupon" ADD CONSTRAINT "cupon_tope_check" CHECK ("tope_descuento" IS NULL OR "tope_descuento" > 0);
ALTER TABLE "cupon" ADD CONSTRAINT "cupon_compra_minima_check" CHECK ("compra_minima" IS NULL OR "compra_minima" > 0);
ALTER TABLE "cupon" ADD CONSTRAINT "cupon_usos_check" CHECK (
  ("usos_maximos" IS NULL OR "usos_maximos" > 0) AND ("usos_por_cuenta" IS NULL OR "usos_por_cuenta" > 0)
);
ALTER TABLE "cupon" ADD CONSTRAINT "cupon_vigencia_check" CHECK (
  "fecha_inicio" IS NULL OR "fecha_fin" IS NULL OR "fecha_inicio" < "fecha_fin"
);
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_monto_descuento_check" CHECK ("monto_descuento" >= 0);
