-- CreateTable
CREATE TABLE "historial_rol" (
    "id_historial_rol" SERIAL NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "id_usuario_responsable" INTEGER NOT NULL,
    "rol_anterior" VARCHAR(30) NOT NULL,
    "rol_nuevo" VARCHAR(30) NOT NULL,
    "motivo" TEXT,
    "fecha_cambio" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historial_rol_pkey" PRIMARY KEY ("id_historial_rol")
);

-- CreateIndex
CREATE INDEX "historial_rol_id_usuario_idx" ON "historial_rol"("id_usuario");

-- AddForeignKey
ALTER TABLE "historial_rol" ADD CONSTRAINT "historial_rol_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_rol" ADD CONSTRAINT "historial_rol_id_usuario_responsable_fkey" FOREIGN KEY ("id_usuario_responsable") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE CASCADE;
