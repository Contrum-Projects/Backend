# Despliegue en una VPS (demo)

Tienda, panel y API en un servidor con Docker y nginx, en **un solo subdominio** (SCRUM-166).
Mercado Pago, Chilexpress y Khipu quedan en **modo de prueba**.

```
Internet ──443──▶ nginx ──▶ tienda (Next, 127.0.0.1:3001) ──red interna──▶ api (:3000)
                                                                  ├─▶ db (PostgreSQL 17)
                                                                  └─▶ redis (Redis 8, AOF)
```

Todo pasa por Next, igual que en desarrollo: la cookie de sesión es `SameSite=Strict` y solo
funciona en el mismo origen, así que no hace falta CORS ni otro certificado. La API, la base y
Redis no publican puertos.

## 0. Antes de empezar

- Que `main` tenga mergeado lo que se va a mostrar, en los dos repos. Sin SCRUM-151 no hay
  pantalla de bodegas, y sin bodegas no se puede cargar stock.
- Servidor con Docker (con `docker compose`), nginx y certbot (`sudo apt install certbot python3-certbot-nginx`).
- **Memoria:** con 4 GB alcanza para correr todo, pero compilar Next pide bastante. Agrega 2 GB
  de swap si el servidor no tiene:

  ```bash
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```

## 1. Subdominio

En el DNS del dominio, crea un registro **A** del subdominio (p. ej. `demo.ejemplo.cl`) con la IP
de la VPS. Lo que ya usa el dominio no cambia. Revisa que resuelva con `dig +short demo.ejemplo.cl`.

## 2. Código y configuración

```bash
mkdir -p ~/cabello-perfecto && cd ~/cabello-perfecto
git clone https://github.com/Contrum-Projects/Backend.git cp-backend
git clone https://github.com/Contrum-Projects/Frontend.git cp-frontend
cd cp-backend/despliegue
cp .env.example .env
nano .env
```

Completa el `.env` siguiendo sus comentarios: reemplaza `demo.ejemplo.cl` por tu subdominio y
genera las contraseñas y secretos con `openssl rand`. Lo mínimo para que la API arranque:
`POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `URL_TIENDA`,
`RESEND_API_KEY` y `CORREO_REMITENTE`.

## 3. Levantar

```bash
docker compose build api        # de a una imagen, por la memoria
docker compose build tienda
docker compose up -d
docker compose run --rm semilla # solo la primera vez: regiones, comunas y administrador
docker compose ps               # api «healthy», tienda «running», migrate «exited (0)»
```

## 4. nginx y HTTPS

```bash
sudo cp nginx/cabello-perfecto.conf /etc/nginx/sites-available/
sudo sed -i 's/demo.ejemplo.cl/TU_SUBDOMINIO/' /etc/nginx/sites-available/cabello-perfecto.conf
sudo ln -s /etc/nginx/sites-available/cabello-perfecto.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d TU_SUBDOMINIO
```

Abre `https://TU_SUBDOMINIO` y entra al panel en `/ingresar` con `SEED_ADMIN_EMAIL` y
`SEED_ADMIN_PASSWORD`.

## 5. Servicios externos (modo de prueba)

| Servicio | Qué configurar |
| --- | --- |
| **Resend** | Verifica el subdominio en Resend (te da registros DNS para el remitente). Sin eso, los correos de confirmación no salen y no se puede activar una cuenta. Webhook opcional: `https://TU_SUBDOMINIO/api/marketing/rebotes`, evento `email.bounced` |
| **Mercado Pago** | En «Tus integraciones», usa las **credenciales de prueba**. Webhook: `https://TU_SUBDOMINIO/api/pagos/notificaciones`, evento «Pagos», y copia la clave secreta a `MERCADOPAGO_WEBHOOK_SECRET`. Para pagar, crea un comprador de prueba y usa las tarjetas de prueba |
| **Chilexpress** | Claves del ambiente de prueba de Chilexpress Developers. `CHILEXPRESS_URL_BASE` ya apunta a `testservices` |
| **Khipu** | Opcional. Sin credenciales, la verificación de profesionales pasa a revisión manual con documentos, que se resuelve en el panel |
| **R2** | Sin las cinco variables no se pueden subir fotos. Si cambias `R2_URL_PUBLICA`, reconstruye la tienda (`docker compose build tienda`) |

Después de cambiar el `.env`: `docker compose up -d` (la API se recrea sola).

## 6. Datos para la demo

La semilla de producción **no** crea bodegas ni productos. Desde el panel, como administrador:

1. **Inventario › Bodegas:** crea una bodega con sus ubicaciones y márcala como bodega de
   despacho (es el origen de la cotización y de las OT).
2. **Personal:** invita a un vendedor y a un bodeguero (les llega el correo de invitación).
3. **Productos:** crea productos con formatos, fotos y precios; uno exclusivo para profesionales.
4. **Inventario › Entradas:** carga stock.
5. Registra una cuenta de cliente en la tienda y haz una compra con el comprador de prueba.

`pruebas-manuales.md` (en la carpeta de trabajo del equipo) sirve como recorrido completo.

## Operación

```bash
# Actualizar a lo último de main
cd ~/cabello-perfecto/cp-frontend && git pull
cd ~/cabello-perfecto/cp-backend && git pull
cd despliegue && docker compose build api && docker compose build tienda && docker compose up -d

docker compose logs -f api              # logs de la API
docker compose exec db pg_dump -U cp cabello_perfecto > respaldo-$(date +%F).sql   # respaldo
```

Si una migración falla, la API no arranca: revisa `docker compose logs migrate`.
