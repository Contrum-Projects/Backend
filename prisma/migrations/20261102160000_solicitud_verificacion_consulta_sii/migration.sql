-- AlterTable
ALTER TABLE "solicitud_verificacion" ADD COLUMN     "fecha_consulta_sii" TIMESTAMPTZ(6),
ADD COLUMN     "giros_sii" JSONB,
ADD COLUMN     "operacion_consulta_sii" VARCHAR(36),
ADD COLUMN     "proveedor_consulta_sii" VARCHAR(30),
ADD COLUMN     "resultado_consulta_sii" VARCHAR(30);
