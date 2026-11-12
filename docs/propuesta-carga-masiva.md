# Propuesta: carga masiva de productos, formatos e imágenes

> Estado: **borrador para revisar con el equipo**. No hay código ni historia todavía.

## Objetivo

Que el administrador (permiso `catalogo.gestionar`) pueda dar de alta muchos productos y formatos
de una vez, sobre todo en la carga inicial del catálogo y cuando llegan listas de proveedores, en
vez de crearlos uno por uno en el panel.

La propuesta separa la carga en **dos pasos independientes**:

1. Un **archivo (CSV o Excel)** con los datos de productos y formatos.
2. Una **carpeta de imágenes** nombradas por SKU.

## Paso 1: datos de productos y formatos

### Flujo

1. El administrador **descarga una plantilla** con las columnas, un ejemplo y la lista de marcas y
   categorías válidas.
2. La llena con **una fila por formato**. Las columnas del producto (nombre, descripción, marca,
   categoría, canal de venta) se repiten, y las filas del mismo producto se agrupan.
3. **Sube el archivo** y el sistema muestra una **vista previa**: «se crearán 40 productos y 95
   formatos», con los errores marcados por fila («fila 12: el SKU ya existe»).
4. **Confirma** y todo se guarda en una sola transacción: entra completo o no entra nada.

### Para el cliente

- **Fácil** si la plantilla viene bien hecha: ejemplos, listas desplegables y una columna por dato.
- **Lo que le costará más:**
  - **Medidas y peso:** son obligatorios en cada formato (`pesoGramos`, `altoCm`, `anchoCm`,
    `largoCm`) y muchas veces no los tiene a mano.
  - **Decimales:** el Excel en Chile usa coma (`12,5`) y separa con `;`. Hay que aceptar ambos
    formatos.

### Para el sistema

Ya existe: validaciones de SKU y código de barras únicos, formato predeterminado y categorías, y
la lógica de creación de `formatos.service.ts`. `bullmq` ya está instalado por si algún día se
cargan miles de filas.

| Tema                        | Dificultad           | Detalle                                                                                                                                                                    |
| --------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leer el archivo             | Baja                 | Con CSV no hace falta nada nuevo. Para `.xlsx` habría que agregar una librería como `exceljs` (dependencia nueva).                                                         |
| Validar el archivo completo | Media                | SKU y códigos de barras repetidos dentro del archivo y contra la base, marcas y categorías por nombre, un solo predeterminado por producto.                                |
| Imágenes                    | Alta en el archivo   | La regla E3 pide al menos una imagen por artículo. Se resuelve con el paso 2 (más abajo).                                                                                  |
| Precios                     | Media                | Hoy el formato nace sin precio (E3-H2). Si la carga trae precios, cada uno debe quedar en `HistorialPrecio` con quién y motivo, respetando el precio profesional (RNF-04). |
| Stock                       | —                    | **No incluirlo.** Las existencias entran por `EntradaInventario` y su flujo propio.                                                                                        |
| Crear vs. actualizar        | Alta si se actualiza | Solo crear es simple. «Si el SKU existe, actualízalo» duplica la complejidad: cambios de precio, formatos que se desactivan, conflictos.                                   |
| Caché del catálogo          | Baja                 | Invalidar una sola vez al final, no fila por fila.                                                                                                                         |

## Paso 2: imágenes

### Lo que ya existe

La subida actual (`imagenes.service.ts`, `subida-imagen.interceptor.ts`) recibe **una imagen por
petición**, de hasta 4 MB, JPEG, PNG o WebP (revisa el tipo por los primeros bytes), con un máximo
de 10 por artículo y una principal. El archivo va directo al almacén, sin pasar por el disco del
servidor (RNF-20).

### Opciones evaluadas

| Opción                                                     | Cliente                                                                 | Sistema                                                                                             | Veredicto       |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------- |
| **A. Arrastrar una carpeta de imágenes nombradas por SKU** | Fácil: nombra los archivos y los arrastra                               | Poco backend nuevo: reutiliza la subida que ya existe                                               | ✅ Recomendada  |
| B. Un ZIP con todo dentro                                  | Fácil                                                                   | Difícil: descomprimir en el servidor (dependencia nueva), subidas grandes, ZIPs maliciosos, memoria | ❌ Mucho riesgo |
| C. Columna con URLs en el Excel                            | Parece fácil, pero los links de Drive o Dropbox casi nunca son directos | El servidor descargaría desde internet: riesgo SSRF, enlaces caídos, tiempos de espera              | ❌ Evitar       |

### Cómo funcionaría la opción A

1. El cliente nombra los archivos con el SKU: `SH-500.jpg` es la principal; `SH-500_2.jpg`,
   `SH-500_3.jpg` son las siguientes, en ese orden.
2. En el panel va a **«Subir imágenes»** y arrastra la carpeta completa (después de la carga
   masiva o en cualquier momento).
3. Antes de subir nada, el navegador muestra el **emparejamiento**:
   - ✅ 92 imágenes con su artículo;
   - ⚠️ 3 archivos cuyo SKU no existe;
   - ⚠️ 5 artículos que siguen sin imagen;
   - ❌ 2 archivos de más de 4 MB o que no son JPEG, PNG ni WebP.
4. Al confirmar, el frontend las sube **una por una** al endpoint actual, con barra de progreso.
   Si alguna falla, se marca y se puede reintentar sin repetir las demás.

Ventajas: casi todo es frontend, el backend no cambia sus reglas (tamaño, tipo, máximo de 10, una
principal) y sirve también fuera de la carga masiva (por ejemplo, cambiar las fotos de 50
productos de una vez).

### Puntos a revisar

- **Pasar del SKU al artículo:** la subida usa el id del artículo. Si no hay un endpoint que
  resuelva varios SKU de una vez, el backend tendría que agregar uno pequeño.
- **Límite de peticiones:** si la subida tiene límite por minuto, 200 imágenes seguidas lo pasan.
  Subir en tandas o ajustar el límite solo para esa ruta.
- **Artículo que ya tiene imágenes:** decidir si las nuevas se agregan o reemplazan. Para empezar,
  lo más seguro es agregar.
- **Regla «al menos una imagen» (E3):** entre la carga de datos y la de imágenes el artículo no
  tiene ninguna. Debe quedar **pendiente y no visible en la tienda** hasta tener imagen y precio,
  y el panel debería listar los pendientes.

## Esfuerzo estimado

| Alcance                                                                                | Backend           | Frontend |
| -------------------------------------------------------------------------------------- | ----------------- | -------- |
| MVP de datos: solo crear, CSV o Excel, sin imágenes ni precios, vista previa y errores | 2–3 días          | 2–3 días |
| Imágenes por carpeta (opción A)                                                        | ≤ medio día       | ~2 días  |
| Versión completa: precios y actualización por SKU                                      | el doble o triple | ídem     |

## Recomendación

1. Partir por el **MVP de datos** (solo creación). Los artículos quedan **pendientes de imagen y
   precio**, y el panel los lista para completarlos con las pantallas que ya existen.
2. Segunda historia: **imágenes por carpeta** (opción A).
3. Más adelante, si hace falta: precios en la carga y actualización masiva por SKU.

## Decisiones pendientes

1. ¿Basta con CSV o el cliente necesita Excel (`.xlsx`)?
2. ¿Una marca o categoría que no existe se crea sola o da error?
3. ¿Se acepta que un artículo exista sin imagen mientras está pendiente? (cambia la regla E3)
4. Imágenes de un artículo que ya tiene: ¿agregar o reemplazar?
