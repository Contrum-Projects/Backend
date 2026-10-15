-- CreateTable
CREATE TABLE "usuario" (
    "id_usuario" SERIAL NOT NULL,
    "codigo_publico" VARCHAR(36) NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "apellido" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "contrasena_hash" VARCHAR(255) NOT NULL,
    "rol" VARCHAR(30) NOT NULL,
    "rut" VARCHAR(12),
    "fecha_nacimiento" DATE,
    "genero" VARCHAR(30),
    "telefono" VARCHAR(20),
    "fecha_registro" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_verificacion_correo" TIMESTAMPTZ(6),
    "acepta_marketing_email" BOOLEAN NOT NULL DEFAULT false,
    "fecha_consentimiento_marketing" TIMESTAMPTZ(6),
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id_usuario")
);

-- CreateTable
CREATE TABLE "direccion" (
    "id_direccion" SERIAL NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "id_comuna" INTEGER NOT NULL,
    "calle" VARCHAR(150) NOT NULL,
    "numero" VARCHAR(20) NOT NULL,
    "referencia" VARCHAR(255),
    "es_principal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "direccion_pkey" PRIMARY KEY ("id_direccion")
);

-- CreateTable
CREATE TABLE "token_correo" (
    "id_token" SERIAL NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "tipo" VARCHAR(30) NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_expiracion" TIMESTAMPTZ(6) NOT NULL,
    "fecha_uso" TIMESTAMPTZ(6),

    CONSTRAINT "token_correo_pkey" PRIMARY KEY ("id_token")
);

-- CreateTable
CREATE TABLE "sesion" (
    "id_sesion" SERIAL NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "token_refresco_hash" VARCHAR(255) NOT NULL,
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_expiracion" TIMESTAMPTZ(6) NOT NULL,
    "fecha_revocacion" TIMESTAMPTZ(6),
    "dispositivo" VARCHAR(255),

    CONSTRAINT "sesion_pkey" PRIMARY KEY ("id_sesion")
);

-- CreateTable
CREATE TABLE "perfil_profesional" (
    "id_perfil" SERIAL NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "id_comuna" INTEGER,
    "anos_experiencia" INTEGER NOT NULL,
    "modalidad" VARCHAR(30) NOT NULL,
    "especialidades" VARCHAR(30)[],
    "nombre_lugar_trabajo" VARCHAR(150),
    "red_social" VARCHAR(255),
    "fecha_actualizacion" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "perfil_profesional_pkey" PRIMARY KEY ("id_perfil")
);

-- CreateTable
CREATE TABLE "solicitud_verificacion" (
    "id_solicitud" SERIAL NOT NULL,
    "id_usuario_solicitante" INTEGER NOT NULL,
    "id_usuario_resolutor" INTEGER,
    "fecha_solicitud" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_resolucion" TIMESTAMPTZ(6),
    "estado" VARCHAR(30) NOT NULL,
    "motivo_rechazo" TEXT,
    "puntaje_confianza" INTEGER,
    "version_reglas" VARCHAR(20),

    CONSTRAINT "solicitud_verificacion_pkey" PRIMARY KEY ("id_solicitud")
);

-- CreateTable
CREATE TABLE "antecedente" (
    "id_antecedente" SERIAL NOT NULL,
    "id_solicitud" INTEGER NOT NULL,
    "tipo" VARCHAR(30) NOT NULL,
    "nombre_archivo" VARCHAR(255) NOT NULL,
    "ubicacion_archivo" VARCHAR(500) NOT NULL,
    "hash_archivo" VARCHAR(64) NOT NULL,
    "estado_ocr" VARCHAR(30) NOT NULL,
    "resultado_ocr" TEXT,
    "fecha_proceso_ocr" TIMESTAMPTZ(6),
    "fecha_eliminacion_archivo" TIMESTAMPTZ(6),

    CONSTRAINT "antecedente_pkey" PRIMARY KEY ("id_antecedente")
);

-- CreateTable
CREATE TABLE "resultado_factor_confianza" (
    "id_solicitud" INTEGER NOT NULL,
    "codigo_factor" VARCHAR(50) NOT NULL,
    "resultado" VARCHAR(30) NOT NULL,
    "puntos" INTEGER NOT NULL,
    "detalle" TEXT,
    "fecha_evaluacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resultado_factor_confianza_pkey" PRIMARY KEY ("id_solicitud","codigo_factor")
);

-- CreateTable
CREATE TABLE "marca" (
    "id_marca" SERIAL NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "marca_pkey" PRIMARY KEY ("id_marca")
);

-- CreateTable
CREATE TABLE "categoria" (
    "id_categoria" SERIAL NOT NULL,
    "id_categoria_padre" INTEGER,
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" VARCHAR(255),

    CONSTRAINT "categoria_pkey" PRIMARY KEY ("id_categoria")
);

-- CreateTable
CREATE TABLE "producto" (
    "id_producto" SERIAL NOT NULL,
    "id_marca" INTEGER,
    "id_categoria" INTEGER NOT NULL,
    "nombre" VARCHAR(200) NOT NULL,
    "descripcion" TEXT NOT NULL,
    "origen_descripcion" VARCHAR(30) NOT NULL,
    "canal_venta" VARCHAR(30) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "producto_pkey" PRIMARY KEY ("id_producto")
);

-- CreateTable
CREATE TABLE "articulo_venta" (
    "id_articulo" SERIAL NOT NULL,
    "sku" VARCHAR(50) NOT NULL,
    "tipo" VARCHAR(30) NOT NULL,
    "precio_minorista_neto" DECIMAL(12,2),
    "precio_mayorista_neto" DECIMAL(12,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "articulo_venta_pkey" PRIMARY KEY ("id_articulo")
);

-- CreateTable
CREATE TABLE "formato_producto" (
    "id_formato" INTEGER NOT NULL,
    "id_producto" INTEGER NOT NULL,
    "codigo_barras" VARCHAR(14),
    "nombre_formato" VARCHAR(100) NOT NULL,
    "contenido" DECIMAL(10,2),
    "unidad_medida" VARCHAR(30),
    "fecha_vencimiento" DATE,
    "stock_minimo" INTEGER NOT NULL DEFAULT 0,
    "peso_gramos" INTEGER NOT NULL,
    "alto_cm" DECIMAL(7,2) NOT NULL,
    "ancho_cm" DECIMAL(7,2) NOT NULL,
    "largo_cm" DECIMAL(7,2) NOT NULL,
    "es_predeterminado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "formato_producto_pkey" PRIMARY KEY ("id_formato")
);

-- CreateTable
CREATE TABLE "pack" (
    "id_pack" INTEGER NOT NULL,
    "nombre" VARCHAR(200) NOT NULL,
    "descripcion" TEXT NOT NULL,
    "canal_venta" VARCHAR(30) NOT NULL,
    "fecha_inicio_vigencia" DATE,
    "fecha_fin_vigencia" DATE,
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pack_pkey" PRIMARY KEY ("id_pack")
);

-- CreateTable
CREATE TABLE "componente_pack" (
    "id_pack" INTEGER NOT NULL,
    "id_formato" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,

    CONSTRAINT "componente_pack_pkey" PRIMARY KEY ("id_pack","id_formato")
);

-- CreateTable
CREATE TABLE "imagen_articulo" (
    "id_imagen" SERIAL NOT NULL,
    "id_articulo" INTEGER NOT NULL,
    "ubicacion_archivo" VARCHAR(500) NOT NULL,
    "orden" INTEGER NOT NULL,
    "es_principal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "imagen_articulo_pkey" PRIMARY KEY ("id_imagen")
);

-- CreateTable
CREATE TABLE "historial_precio" (
    "id_historial_precio" SERIAL NOT NULL,
    "id_articulo" INTEGER NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "tipo_precio" VARCHAR(30) NOT NULL,
    "precio_neto" DECIMAL(12,2) NOT NULL,
    "fecha_inicio_vigencia" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_fin_vigencia" TIMESTAMPTZ(6),
    "motivo" TEXT,

    CONSTRAINT "historial_precio_pkey" PRIMARY KEY ("id_historial_precio")
);

-- CreateTable
CREATE TABLE "carrito" (
    "id_carrito" SERIAL NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_actualizacion" TIMESTAMPTZ(6) NOT NULL,
    "fecha_recordatorio" TIMESTAMPTZ(6),
    "recordatorios_enviados" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "carrito_pkey" PRIMARY KEY ("id_carrito")
);

-- CreateTable
CREATE TABLE "item_carrito" (
    "id_carrito" INTEGER NOT NULL,
    "id_articulo" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "fecha_agregado" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_carrito_pkey" PRIMARY KEY ("id_carrito","id_articulo")
);

-- CreateTable
CREATE TABLE "pedido" (
    "id_pedido" SERIAL NOT NULL,
    "codigo_publico" VARCHAR(12) NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "id_datos_facturacion" INTEGER,
    "fecha_pedido" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_expiracion_pago" TIMESTAMPTZ(6) NOT NULL,
    "estado_actual" VARCHAR(30) NOT NULL,
    "tipo_entrega" VARCHAR(30) NOT NULL,
    "tipo_documento_solicitado" VARCHAR(30) NOT NULL,
    "porcentaje_iva" DECIMAL(5,2) NOT NULL,
    "monto_neto" INTEGER NOT NULL,
    "monto_iva" INTEGER NOT NULL,
    "monto_total" INTEGER NOT NULL,

    CONSTRAINT "pedido_pkey" PRIMARY KEY ("id_pedido")
);

-- CreateTable
CREATE TABLE "detalle_pedido" (
    "id_pedido" INTEGER NOT NULL,
    "id_articulo" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precio_unitario_neto_aplicado" DECIMAL(12,2) NOT NULL,
    "tipo_precio" VARCHAR(30) NOT NULL,

    CONSTRAINT "detalle_pedido_pkey" PRIMARY KEY ("id_pedido","id_articulo")
);

-- CreateTable
CREATE TABLE "pago" (
    "id_pago" SERIAL NOT NULL,
    "id_pedido" INTEGER NOT NULL,
    "id_transaccion_externa" VARCHAR(100),
    "monto" INTEGER NOT NULL,
    "estado" VARCHAR(30) NOT NULL,
    "fecha_pago" TIMESTAMPTZ(6),
    "medio_pago" VARCHAR(50),

    CONSTRAINT "pago_pkey" PRIMARY KEY ("id_pago")
);

-- CreateTable
CREATE TABLE "evento_pago" (
    "id_evento" SERIAL NOT NULL,
    "id_pago" INTEGER,
    "id_evento_externo" VARCHAR(100) NOT NULL,
    "tipo_evento" VARCHAR(50) NOT NULL,
    "fecha_recepcion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado_procesamiento" VARCHAR(30) NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "fecha_procesamiento" TIMESTAMPTZ(6),
    "contenido_recibido" TEXT,

    CONSTRAINT "evento_pago_pkey" PRIMARY KEY ("id_evento")
);

-- CreateTable
CREATE TABLE "datos_facturacion" (
    "id_datos_facturacion" SERIAL NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "id_comuna" INTEGER NOT NULL,
    "rut" VARCHAR(12) NOT NULL,
    "razon_social" VARCHAR(150) NOT NULL,
    "giro" VARCHAR(150) NOT NULL,
    "direccion" VARCHAR(200) NOT NULL,
    "correo_facturacion" VARCHAR(254),
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "datos_facturacion_pkey" PRIMARY KEY ("id_datos_facturacion")
);

-- CreateTable
CREATE TABLE "documento_tributario" (
    "id_documento" SERIAL NOT NULL,
    "id_pedido" INTEGER NOT NULL,
    "id_documento_anulador" INTEGER,
    "tipo" VARCHAR(30) NOT NULL,
    "folio" INTEGER,
    "fecha_emision" DATE,
    "estado" VARCHAR(30) NOT NULL,
    "monto_neto" INTEGER NOT NULL,
    "monto_iva" INTEGER NOT NULL,
    "monto_total" INTEGER NOT NULL,
    "id_documento_externo" VARCHAR(100),
    "ubicacion_archivo" VARCHAR(500),
    "rut_receptor" VARCHAR(12),
    "razon_social_receptor" VARCHAR(150),
    "giro_receptor" VARCHAR(150),
    "direccion_receptor" VARCHAR(200),
    "comuna_receptor" VARCHAR(100),

    CONSTRAINT "documento_tributario_pkey" PRIMARY KEY ("id_documento")
);

-- CreateTable
CREATE TABLE "envio" (
    "id_envio" SERIAL NOT NULL,
    "id_pedido" INTEGER NOT NULL,
    "id_comuna" INTEGER NOT NULL,
    "servicio_envio" VARCHAR(50) NOT NULL,
    "costo_neto" DECIMAL(12,2) NOT NULL,
    "codigo_seguimiento" VARCHAR(100),
    "fecha_estimada" DATE,
    "estado_envio" VARCHAR(30) NOT NULL,
    "destinatario" VARCHAR(150) NOT NULL,
    "telefono_contacto" VARCHAR(20),
    "calle" VARCHAR(150) NOT NULL,
    "numero" VARCHAR(20) NOT NULL,
    "referencia" VARCHAR(255),

    CONSTRAINT "envio_pkey" PRIMARY KEY ("id_envio")
);

-- CreateTable
CREATE TABLE "historial_estado_pedido" (
    "id_pedido" INTEGER NOT NULL,
    "correlativo" INTEGER NOT NULL,
    "id_usuario" INTEGER,
    "fecha_hora" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" VARCHAR(30) NOT NULL,
    "comentario" TEXT,

    CONSTRAINT "historial_estado_pedido_pkey" PRIMARY KEY ("id_pedido","correlativo")
);

-- CreateTable
CREATE TABLE "notificacion" (
    "id_notificacion" SERIAL NOT NULL,
    "id_usuario" INTEGER,
    "id_lead" INTEGER,
    "id_pedido" INTEGER,
    "id_campana" INTEGER,
    "tipo" VARCHAR(30) NOT NULL,
    "asunto" VARCHAR(200) NOT NULL,
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado_envio" VARCHAR(30) NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "fecha_envio" TIMESTAMPTZ(6),
    "fecha_apertura" TIMESTAMPTZ(6),
    "fecha_clic" TIMESTAMPTZ(6),

    CONSTRAINT "notificacion_pkey" PRIMARY KEY ("id_notificacion")
);

-- CreateTable
CREATE TABLE "lead" (
    "id_lead" SERIAL NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "fecha_suscripcion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origen" VARCHAR(30) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "fecha_baja" TIMESTAMPTZ(6),

    CONSTRAINT "lead_pkey" PRIMARY KEY ("id_lead")
);

-- CreateTable
CREATE TABLE "campana" (
    "id_campana" SERIAL NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "tipo" VARCHAR(30) NOT NULL,
    "asunto" VARCHAR(200) NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "segmento" TEXT,
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_encolado" TIMESTAMPTZ(6),

    CONSTRAINT "campana_pkey" PRIMARY KEY ("id_campana")
);

-- CreateTable
CREATE TABLE "proveedor" (
    "id_proveedor" SERIAL NOT NULL,
    "rut" VARCHAR(12) NOT NULL,
    "razon_social" VARCHAR(150) NOT NULL,
    "nombre_contacto" VARCHAR(150),
    "telefono" VARCHAR(20),
    "email" VARCHAR(254),
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "proveedor_pkey" PRIMARY KEY ("id_proveedor")
);

-- CreateTable
CREATE TABLE "entrada_inventario" (
    "id_entrada" SERIAL NOT NULL,
    "id_proveedor" INTEGER NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "fecha_recepcion" DATE NOT NULL,
    "tipo_documento_proveedor" VARCHAR(30) NOT NULL,
    "numero_documento_proveedor" VARCHAR(50) NOT NULL,
    "observacion" TEXT,

    CONSTRAINT "entrada_inventario_pkey" PRIMARY KEY ("id_entrada")
);

-- CreateTable
CREATE TABLE "detalle_entrada" (
    "id_entrada" INTEGER NOT NULL,
    "id_formato" INTEGER NOT NULL,
    "cantidad_recibida" INTEGER NOT NULL,
    "costo_unitario_neto" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "detalle_entrada_pkey" PRIMARY KEY ("id_entrada","id_formato")
);

-- CreateTable
CREATE TABLE "bodega" (
    "id_bodega" SERIAL NOT NULL,
    "id_comuna" INTEGER NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "direccion" VARCHAR(200) NOT NULL,
    "tipo" VARCHAR(30) NOT NULL,
    "abastece_venta_online" BOOLEAN NOT NULL DEFAULT true,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "bodega_pkey" PRIMARY KEY ("id_bodega")
);

-- CreateTable
CREATE TABLE "ubicacion" (
    "id_ubicacion" SERIAL NOT NULL,
    "id_bodega" INTEGER NOT NULL,
    "codigo" VARCHAR(30) NOT NULL,
    "zona" VARCHAR(20),
    "pasillo" VARCHAR(20),
    "estante" VARCHAR(20),
    "nivel" VARCHAR(20),
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ubicacion_pkey" PRIMARY KEY ("id_ubicacion")
);

-- CreateTable
CREATE TABLE "existencia" (
    "id_formato" INTEGER NOT NULL,
    "id_ubicacion" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 0,
    "fecha_actualizacion" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "existencia_pkey" PRIMARY KEY ("id_formato","id_ubicacion")
);

-- CreateTable
CREATE TABLE "movimiento_inventario" (
    "id_movimiento" SERIAL NOT NULL,
    "id_formato" INTEGER NOT NULL,
    "id_entrada" INTEGER,
    "id_ubicacion_origen" INTEGER,
    "id_ubicacion_destino" INTEGER,
    "id_usuario" INTEGER,
    "id_pedido" INTEGER,
    "fecha_hora" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tipo" VARCHAR(30) NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "observacion" TEXT,

    CONSTRAINT "movimiento_inventario_pkey" PRIMARY KEY ("id_movimiento")
);

-- CreateTable
CREATE TABLE "region" (
    "id_region" SERIAL NOT NULL,
    "codigo_cut" CHAR(2) NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,

    CONSTRAINT "region_pkey" PRIMARY KEY ("id_region")
);

-- CreateTable
CREATE TABLE "comuna" (
    "id_comuna" SERIAL NOT NULL,
    "id_region" INTEGER NOT NULL,
    "codigo_cut" CHAR(5) NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,

    CONSTRAINT "comuna_pkey" PRIMARY KEY ("id_comuna")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_codigo_publico_key" ON "usuario"("codigo_publico");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_rut_key" ON "usuario"("rut");

-- CreateIndex
CREATE INDEX "direccion_id_usuario_idx" ON "direccion"("id_usuario");

-- CreateIndex
CREATE UNIQUE INDEX "token_correo_token_hash_key" ON "token_correo"("token_hash");

-- CreateIndex
CREATE INDEX "token_correo_id_usuario_idx" ON "token_correo"("id_usuario");

-- CreateIndex
CREATE UNIQUE INDEX "sesion_token_refresco_hash_key" ON "sesion"("token_refresco_hash");

-- CreateIndex
CREATE INDEX "sesion_id_usuario_idx" ON "sesion"("id_usuario");

-- CreateIndex
CREATE UNIQUE INDEX "perfil_profesional_id_usuario_key" ON "perfil_profesional"("id_usuario");

-- CreateIndex
CREATE INDEX "solicitud_verificacion_id_usuario_solicitante_idx" ON "solicitud_verificacion"("id_usuario_solicitante");

-- CreateIndex
CREATE INDEX "solicitud_verificacion_estado_idx" ON "solicitud_verificacion"("estado");

-- CreateIndex
CREATE INDEX "antecedente_id_solicitud_idx" ON "antecedente"("id_solicitud");

-- CreateIndex
CREATE UNIQUE INDEX "marca_nombre_key" ON "marca"("nombre");

-- CreateIndex
CREATE INDEX "categoria_id_categoria_padre_idx" ON "categoria"("id_categoria_padre");

-- CreateIndex
CREATE INDEX "producto_id_categoria_idx" ON "producto"("id_categoria");

-- CreateIndex
CREATE INDEX "producto_id_marca_idx" ON "producto"("id_marca");

-- CreateIndex
CREATE UNIQUE INDEX "articulo_venta_sku_key" ON "articulo_venta"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "formato_producto_codigo_barras_key" ON "formato_producto"("codigo_barras");

-- CreateIndex
CREATE INDEX "formato_producto_id_producto_idx" ON "formato_producto"("id_producto");

-- CreateIndex
CREATE INDEX "imagen_articulo_id_articulo_idx" ON "imagen_articulo"("id_articulo");

-- CreateIndex
CREATE INDEX "historial_precio_id_articulo_idx" ON "historial_precio"("id_articulo");

-- CreateIndex
CREATE UNIQUE INDEX "carrito_id_usuario_key" ON "carrito"("id_usuario");

-- CreateIndex
CREATE UNIQUE INDEX "pedido_codigo_publico_key" ON "pedido"("codigo_publico");

-- CreateIndex
CREATE INDEX "pedido_id_usuario_idx" ON "pedido"("id_usuario");

-- CreateIndex
CREATE INDEX "pedido_estado_actual_idx" ON "pedido"("estado_actual");

-- CreateIndex
CREATE UNIQUE INDEX "pago_id_transaccion_externa_key" ON "pago"("id_transaccion_externa");

-- CreateIndex
CREATE INDEX "pago_id_pedido_idx" ON "pago"("id_pedido");

-- CreateIndex
CREATE UNIQUE INDEX "evento_pago_id_evento_externo_key" ON "evento_pago"("id_evento_externo");

-- CreateIndex
CREATE INDEX "evento_pago_estado_procesamiento_idx" ON "evento_pago"("estado_procesamiento");

-- CreateIndex
CREATE INDEX "datos_facturacion_id_usuario_idx" ON "datos_facturacion"("id_usuario");

-- CreateIndex
CREATE INDEX "documento_tributario_id_pedido_idx" ON "documento_tributario"("id_pedido");

-- CreateIndex
CREATE UNIQUE INDEX "documento_tributario_tipo_folio_key" ON "documento_tributario"("tipo", "folio");

-- CreateIndex
CREATE UNIQUE INDEX "envio_id_pedido_key" ON "envio"("id_pedido");

-- CreateIndex
CREATE INDEX "notificacion_estado_envio_idx" ON "notificacion"("estado_envio");

-- CreateIndex
CREATE INDEX "notificacion_id_campana_idx" ON "notificacion"("id_campana");

-- CreateIndex
CREATE UNIQUE INDEX "lead_email_key" ON "lead"("email");

-- CreateIndex
CREATE UNIQUE INDEX "proveedor_rut_key" ON "proveedor"("rut");

-- CreateIndex
CREATE INDEX "entrada_inventario_id_proveedor_idx" ON "entrada_inventario"("id_proveedor");

-- CreateIndex
CREATE UNIQUE INDEX "ubicacion_id_bodega_codigo_key" ON "ubicacion"("id_bodega", "codigo");

-- CreateIndex
CREATE INDEX "movimiento_inventario_id_formato_fecha_hora_idx" ON "movimiento_inventario"("id_formato", "fecha_hora");

-- CreateIndex
CREATE INDEX "movimiento_inventario_id_pedido_idx" ON "movimiento_inventario"("id_pedido");

-- CreateIndex
CREATE UNIQUE INDEX "region_codigo_cut_key" ON "region"("codigo_cut");

-- CreateIndex
CREATE UNIQUE INDEX "comuna_codigo_cut_key" ON "comuna"("codigo_cut");

-- CreateIndex
CREATE INDEX "comuna_id_region_idx" ON "comuna"("id_region");

-- AddForeignKey
ALTER TABLE "direccion" ADD CONSTRAINT "direccion_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direccion" ADD CONSTRAINT "direccion_id_comuna_fkey" FOREIGN KEY ("id_comuna") REFERENCES "comuna"("id_comuna") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_correo" ADD CONSTRAINT "token_correo_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesion" ADD CONSTRAINT "sesion_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfil_profesional" ADD CONSTRAINT "perfil_profesional_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfil_profesional" ADD CONSTRAINT "perfil_profesional_id_comuna_fkey" FOREIGN KEY ("id_comuna") REFERENCES "comuna"("id_comuna") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_verificacion" ADD CONSTRAINT "solicitud_verificacion_id_usuario_solicitante_fkey" FOREIGN KEY ("id_usuario_solicitante") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_verificacion" ADD CONSTRAINT "solicitud_verificacion_id_usuario_resolutor_fkey" FOREIGN KEY ("id_usuario_resolutor") REFERENCES "usuario"("id_usuario") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "antecedente" ADD CONSTRAINT "antecedente_id_solicitud_fkey" FOREIGN KEY ("id_solicitud") REFERENCES "solicitud_verificacion"("id_solicitud") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultado_factor_confianza" ADD CONSTRAINT "resultado_factor_confianza_id_solicitud_fkey" FOREIGN KEY ("id_solicitud") REFERENCES "solicitud_verificacion"("id_solicitud") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categoria" ADD CONSTRAINT "categoria_id_categoria_padre_fkey" FOREIGN KEY ("id_categoria_padre") REFERENCES "categoria"("id_categoria") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto" ADD CONSTRAINT "producto_id_marca_fkey" FOREIGN KEY ("id_marca") REFERENCES "marca"("id_marca") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto" ADD CONSTRAINT "producto_id_categoria_fkey" FOREIGN KEY ("id_categoria") REFERENCES "categoria"("id_categoria") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formato_producto" ADD CONSTRAINT "formato_producto_id_formato_fkey" FOREIGN KEY ("id_formato") REFERENCES "articulo_venta"("id_articulo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formato_producto" ADD CONSTRAINT "formato_producto_id_producto_fkey" FOREIGN KEY ("id_producto") REFERENCES "producto"("id_producto") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack" ADD CONSTRAINT "pack_id_pack_fkey" FOREIGN KEY ("id_pack") REFERENCES "articulo_venta"("id_articulo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "componente_pack" ADD CONSTRAINT "componente_pack_id_pack_fkey" FOREIGN KEY ("id_pack") REFERENCES "pack"("id_pack") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "componente_pack" ADD CONSTRAINT "componente_pack_id_formato_fkey" FOREIGN KEY ("id_formato") REFERENCES "formato_producto"("id_formato") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imagen_articulo" ADD CONSTRAINT "imagen_articulo_id_articulo_fkey" FOREIGN KEY ("id_articulo") REFERENCES "articulo_venta"("id_articulo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_precio" ADD CONSTRAINT "historial_precio_id_articulo_fkey" FOREIGN KEY ("id_articulo") REFERENCES "articulo_venta"("id_articulo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_precio" ADD CONSTRAINT "historial_precio_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrito" ADD CONSTRAINT "carrito_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_carrito" ADD CONSTRAINT "item_carrito_id_carrito_fkey" FOREIGN KEY ("id_carrito") REFERENCES "carrito"("id_carrito") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_carrito" ADD CONSTRAINT "item_carrito_id_articulo_fkey" FOREIGN KEY ("id_articulo") REFERENCES "articulo_venta"("id_articulo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_id_datos_facturacion_fkey" FOREIGN KEY ("id_datos_facturacion") REFERENCES "datos_facturacion"("id_datos_facturacion") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalle_pedido" ADD CONSTRAINT "detalle_pedido_id_pedido_fkey" FOREIGN KEY ("id_pedido") REFERENCES "pedido"("id_pedido") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalle_pedido" ADD CONSTRAINT "detalle_pedido_id_articulo_fkey" FOREIGN KEY ("id_articulo") REFERENCES "articulo_venta"("id_articulo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago" ADD CONSTRAINT "pago_id_pedido_fkey" FOREIGN KEY ("id_pedido") REFERENCES "pedido"("id_pedido") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_pago" ADD CONSTRAINT "evento_pago_id_pago_fkey" FOREIGN KEY ("id_pago") REFERENCES "pago"("id_pago") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "datos_facturacion" ADD CONSTRAINT "datos_facturacion_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "datos_facturacion" ADD CONSTRAINT "datos_facturacion_id_comuna_fkey" FOREIGN KEY ("id_comuna") REFERENCES "comuna"("id_comuna") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento_tributario" ADD CONSTRAINT "documento_tributario_id_pedido_fkey" FOREIGN KEY ("id_pedido") REFERENCES "pedido"("id_pedido") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento_tributario" ADD CONSTRAINT "documento_tributario_id_documento_anulador_fkey" FOREIGN KEY ("id_documento_anulador") REFERENCES "documento_tributario"("id_documento") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envio" ADD CONSTRAINT "envio_id_pedido_fkey" FOREIGN KEY ("id_pedido") REFERENCES "pedido"("id_pedido") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envio" ADD CONSTRAINT "envio_id_comuna_fkey" FOREIGN KEY ("id_comuna") REFERENCES "comuna"("id_comuna") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_estado_pedido" ADD CONSTRAINT "historial_estado_pedido_id_pedido_fkey" FOREIGN KEY ("id_pedido") REFERENCES "pedido"("id_pedido") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_estado_pedido" ADD CONSTRAINT "historial_estado_pedido_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_id_lead_fkey" FOREIGN KEY ("id_lead") REFERENCES "lead"("id_lead") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_id_pedido_fkey" FOREIGN KEY ("id_pedido") REFERENCES "pedido"("id_pedido") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_id_campana_fkey" FOREIGN KEY ("id_campana") REFERENCES "campana"("id_campana") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campana" ADD CONSTRAINT "campana_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrada_inventario" ADD CONSTRAINT "entrada_inventario_id_proveedor_fkey" FOREIGN KEY ("id_proveedor") REFERENCES "proveedor"("id_proveedor") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrada_inventario" ADD CONSTRAINT "entrada_inventario_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalle_entrada" ADD CONSTRAINT "detalle_entrada_id_entrada_fkey" FOREIGN KEY ("id_entrada") REFERENCES "entrada_inventario"("id_entrada") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalle_entrada" ADD CONSTRAINT "detalle_entrada_id_formato_fkey" FOREIGN KEY ("id_formato") REFERENCES "formato_producto"("id_formato") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bodega" ADD CONSTRAINT "bodega_id_comuna_fkey" FOREIGN KEY ("id_comuna") REFERENCES "comuna"("id_comuna") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ubicacion" ADD CONSTRAINT "ubicacion_id_bodega_fkey" FOREIGN KEY ("id_bodega") REFERENCES "bodega"("id_bodega") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "existencia" ADD CONSTRAINT "existencia_id_formato_fkey" FOREIGN KEY ("id_formato") REFERENCES "formato_producto"("id_formato") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "existencia" ADD CONSTRAINT "existencia_id_ubicacion_fkey" FOREIGN KEY ("id_ubicacion") REFERENCES "ubicacion"("id_ubicacion") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_inventario" ADD CONSTRAINT "movimiento_inventario_id_formato_fkey" FOREIGN KEY ("id_formato") REFERENCES "formato_producto"("id_formato") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_inventario" ADD CONSTRAINT "movimiento_inventario_id_entrada_fkey" FOREIGN KEY ("id_entrada") REFERENCES "entrada_inventario"("id_entrada") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_inventario" ADD CONSTRAINT "movimiento_inventario_id_ubicacion_origen_fkey" FOREIGN KEY ("id_ubicacion_origen") REFERENCES "ubicacion"("id_ubicacion") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_inventario" ADD CONSTRAINT "movimiento_inventario_id_ubicacion_destino_fkey" FOREIGN KEY ("id_ubicacion_destino") REFERENCES "ubicacion"("id_ubicacion") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_inventario" ADD CONSTRAINT "movimiento_inventario_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_inventario" ADD CONSTRAINT "movimiento_inventario_id_pedido_fkey" FOREIGN KEY ("id_pedido") REFERENCES "pedido"("id_pedido") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comuna" ADD CONSTRAINT "comuna_id_region_fkey" FOREIGN KEY ("id_region") REFERENCES "region"("id_region") ON DELETE RESTRICT ON UPDATE CASCADE;
