/*
  Warnings:

  - A unique constraint covering the columns `[codigo_seguimiento]` on the table `envio` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "envio_codigo_seguimiento_key" ON "envio"("codigo_seguimiento");
