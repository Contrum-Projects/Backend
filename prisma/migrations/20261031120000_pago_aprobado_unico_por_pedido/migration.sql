-- Un pedido tiene a lo más un pago aprobado (E6-H2). Respaldo del bloqueo de la fila del pedido.
-- Índice parcial: Prisma no lo puede declarar en schema.prisma, por eso solo vive aquí.
CREATE UNIQUE INDEX "pago_id_pedido_aprobado_key" ON "pago"("id_pedido") WHERE "estado" = 'aprobado';
