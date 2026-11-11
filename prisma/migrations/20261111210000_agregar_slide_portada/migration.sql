-- CreateTable
CREATE TABLE "slide_portada" (
    "id_slide" SERIAL NOT NULL,
    "imagen_escritorio" VARCHAR(500) NOT NULL,
    "imagen_celular" VARCHAR(500),
    "orden" INTEGER NOT NULL,
    "tipo_destino" VARCHAR(20) NOT NULL,
    "destino" VARCHAR(40) NOT NULL,
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slide_portada_pkey" PRIMARY KEY ("id_slide")
);
