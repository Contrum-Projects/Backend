-- CreateTable
CREATE TABLE "registro_error" (
    "id_registro_error" SERIAL NOT NULL,
    "codigo_seguimiento" VARCHAR(64) NOT NULL,
    "fecha_hora" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origen" VARCHAR(20) NOT NULL,
    "componente" VARCHAR(150) NOT NULL,
    "metodo" VARCHAR(10),
    "ruta" VARCHAR(500),
    "estado_http" INTEGER,
    "tipo_error" VARCHAR(100) NOT NULL,
    "mensaje" VARCHAR(1000) NOT NULL,
    "traza" TEXT,
    "id_usuario" INTEGER,

    CONSTRAINT "registro_error_pkey" PRIMARY KEY ("id_registro_error")
);

-- CreateIndex
CREATE INDEX "registro_error_fecha_hora_idx" ON "registro_error"("fecha_hora");

-- CreateIndex
CREATE INDEX "registro_error_codigo_seguimiento_idx" ON "registro_error"("codigo_seguimiento");

-- CreateIndex
CREATE INDEX "registro_error_id_usuario_idx" ON "registro_error"("id_usuario");

-- AddForeignKey
ALTER TABLE "registro_error" ADD CONSTRAINT "registro_error_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE SET NULL ON UPDATE CASCADE;
