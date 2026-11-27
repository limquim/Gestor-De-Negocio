# Guía Fase 3: Política de Privacidad + Cobro de Licencias ($10/mes) a Costo $0

---

## Parte 1: Quitar el aviso de Google ("App no verificada")

1. Sube `privacidad.html` junto al resto de los archivos de tu aplicación.
2. Verifica que abre correctamente en: `https://tu-dominio/privacidad.html`
3. Entra a [Google Cloud Console](https://console.cloud.google.com/) > **Google Auth Platform > Desarrollo de marca (Branding)**:
   - Cambia **Nombre de la app** a tu marca comercial (ej: `Gestor Emprendedor`).
   - En **Página principal de la aplicación**, coloca `https://tu-dominio/`.
   - En **Vínculo a la política de privacidad**, coloca `https://tu-dominio/privacidad.html`.
   - En **Dominios autorizados**, agrega tu dominio (para venta masiva conviene un dominio propio `.com` conectado a Cloudflare).
4. Ve a **Público (Audience)** y pulsa **Publicar aplicación** para que cualquier cliente con Gmail pueda conectar su Drive.

---

## Parte 2: Activar Licencias de $10/mes (Elige Modo Rápido o Modo Nube)

### Opción 1 — Modo Rápido (5 minutos, CERO backend)
Ideal para empezar a cobrar hoy mismo con códigos firmados **ECDSA P-256** (imposibles de falsificar y funcionan 100% sin internet):

1. Abre **`admin.html`** en tu computadora o teléfono (guárdalo solo para ti, no necesitas compartir el enlace).
2. Ve a la pestaña **2. Generador Offline + Llaves** y pulsa **Generar nuevo par de llaves**.
3. Guarda tu **Llave Privada** en un lugar seguro (gestor de contraseñas o archivo privado).
4. Copia la **Llave Pública** y pégala en `config.js`:
   ```js
   licenseEnabled: true,
   trialDays: 14,
   monthlyPriceUsd: 10,
   supportWhatsApp: '584141234567',
   licensePublicKey: '{"kty":"EC","crv":"P-256",...}',
   ```
5. Sube `config.js` actualizado.
6. Cuando un cliente te pague $10 (Pago Móvil / Zelle / Binance), abre `admin.html`, escribe su nombre, su ID de dispositivo (opcional) y elige **+30 días** -> pulsa **Enviar al cliente por WhatsApp**. El cliente pega el código `GE1...` y queda activo todo el mes sin internet.

---

### Opción 2 — Modo Nube Completo en Cloudflare Workers + KV (Gratis hasta 100.000 consultas/día)
Agrega **claves cortas (`PRO-XXXX-XXXX`)**, **dashboard de ingresos mensuales (MRR)**, **renovación +30 días en 1 clic**, **límite automático de 1 dispositivo por licencia** y **suspensión remota**:

1. En tu panel de [Cloudflare](https://dash.cloudflare.com/):
   - Ve a **Storage & Databases > KV** y pulsa **Create a namespace** con nombre `LICENSES_KV`.
   - Ve a **Compute (Workers) > Create > Create Worker**, ponle nombre (ej: `licencias-gestor`), pulsa **Deploy** y luego **Edit code**.
   - Borra el código de ejemplo, pega todo el contenido de **`worker_licencias.js`** y pulsa **Deploy**.
2. En la configuración del Worker (**Settings**):
   - En **Bindings > Add > KV Namespace**: Variable name = `LICENSES_KV`, selecciona el namespace creado.
   - En **Variables and Secrets > Add**:
     - `ADMIN_KEY` (Type: Secret): inventa tu contraseña maestra para entrar a `admin.html`.
     - `PRIVATE_KEY_JWK` (Type: Secret): pega la **Llave Privada** generada en `admin.html`.
3. En `config.js` de tu app, coloca:
   ```js
   licenseEnabled: true,
   licensePublicKey: '{"kty":"EC","crv":"P-256",...}',
   licenseApiUrl: 'https://licencias-gestor.tuusuario.workers.dev'
   ```
4. Abre `admin.html` en la pestaña **1. Clientes en la Nube**, ingresa la URL de tu Worker y tu `ADMIN_KEY`. ¡Listo! Ya tienes tu panel SaaS completo a $0/mes.
