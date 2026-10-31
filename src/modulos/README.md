# Módulos de dominio

Un módulo de NestJS por área del negocio, alineado con las épicas del backlog (Jira SCRUM).
Cada módulo se crea cuando se implementa su primera historia, con la estructura:

```
src/modulos/<modulo>/
  <modulo>.module.ts
  <modulo>.controller.ts      # HTTP: valida la entrada (DTOs) y delega, sin lógica de negocio
  <modulo>.service.ts         # Reglas de negocio y transacciones
  <modulo>.service.spec.ts    # Pruebas unitarias del servicio
  dto/                        # DTOs con class-validator (entrada) y tipos de respuesta
```

| Módulo | Épica | Qué cubre |
| --- | --- | --- |
| `cuentas` | E1 | Registro, confirmación de correo, inicio y cierre de sesión, recuperación de contraseña, datos y direcciones |
| `personal` | E13 | Cuentas del personal de tienda, roles fijos y control de acceso |
| `catalogo` | E2, E3 | Catálogo público, búsqueda, administración de productos, formatos, packs, marcas y categorías |
| `ia` | E4 | Sugerencia de descripción desde la foto del reverso |
| `carrito` | E5 | Carrito y mínimo de compra del peluquero |
| `pedidos` | E5, E8 | Creación del pedido, estados e historial |
| `pagos` | E6 | Mercado Pago, notificaciones (webhook) y conciliación |
| `despacho` | E7 | Retiro en tienda, cotización y envío con Chilexpress |
| `facturacion` | E9 | Datos de facturación y documentos tributarios |
| `verificacion` | E10 | Verificación de profesionales, antecedentes y OCR |
| `inventario` | E11 | Proveedores, entradas, salidas, ajustes, existencias y movimientos |
| `marketing` | E12 | Suscripciones, campañas y carritos abandonados |
| `notificaciones` | transversal | Cola de correos y su envío |
| `reportes` | E14 | Indicadores y reportes del panel |
| `territorio` | transversal | Regiones y comunas |

La numeración de épicas sigue el backlog del proyecto; confirma la épica de cada historia en Jira.
