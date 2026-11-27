# Guía rápida: Activar Google Drive automático (Costo $0)

Solo necesitas crear **un único Client ID de Google Cloud** (una sola vez para tu negocio SaaS). Con ese mismo ID, **todos tus clientes emprendedores** podrán respaldar automáticamente sus datos en **su propio Google Drive** sin que tú pagues servidores ni almacenamiento.

---

## Paso 1: Crear el proyecto gratis en Google Cloud

1. Entra en [https://console.cloud.google.com/](https://console.cloud.google.com/) con tu cuenta de Google.
2. Arriba a la izquierda haz clic en el selector de proyectos y pulsa **Proyecto nuevo**.
3. Ponle el nombre de tu app (ej: `Gestor Emprendedor`) y pulsa **Crear**.

## Paso 2: Habilitar la API de Google Drive

1. En el menú lateral ve a **APIs y servicios > Biblioteca**.
2. Busca **Google Drive API**, haz clic en ella y pulsa **Habilitar**. *(Es gratuita para uso estándar de respaldos por usuario).*

## Paso 3: Configurar la Pantalla de Consentimiento OAuth

1. Ve a **APIs y servicios > Pantalla de consentimiento de OAuth** (o **Google Auth Platform > Branding / Audience**).
2. Tipo de usuario: selecciona **Externo** y pulsa **Crear**.
3. Completa solo lo básico:
   - **Nombre de la app:** el nombre comercial de tu herramienta (ej: `Gestor Emprendedor`).
   - **Correo de asistencia:** tu correo de soporte.
   - **Correo del desarrollador:** tu correo.
4. En **Permisos (Scopes)** agrega únicamente:
   - `https://www.googleapis.com/auth/drive.file` *(permiso no sensible: solo permite acceder a los archivos que la propia app crea, nunca a los archivos personales del cliente).*
5. Mientras estés probando contigo y tus primeros amigos, agrega sus correos en **Usuarios de prueba** (hasta 100 correos gratis sin verificación). Cuando quieras lanzarla al público masivo, pulsa **Publicar aplicación** (como solo usa `drive.file`, el proceso es gratuito y no requiere auditoría paga).

## Paso 4: Crear el ID de cliente OAuth (Aplicación web)

1. Ve a **APIs y servicios > Credenciales** (o **Clients**).
2. Pulsa **+ Crear credenciales > ID de cliente de OAuth**.
3. Tipo de aplicación: **Aplicación web**.
4. En **Orígenes de JavaScript autorizados**, agrega la URL donde publicaste tu app en Cloudflare Pages (sin barra `/` al final), por ejemplo:
   - `https://gestor-emprendedor.pages.dev`
   - *(Opcional si pruebas en tu PC: `http://localhost:8080`)*
5. Pulsa **Crear** y copia el **ID de cliente** (termina en `.apps.googleusercontent.com`).

## Paso 5: Pegar el ID en `config.js`

Abre `config.js` en tu repositorio y pega el ID así:

```js
const APP_CONFIG = {
  brandName: 'Gestor Emprendedor',
  edition: 'Emprendedores v2 (Local + Drive)',
  supportWhatsApp: '584141234567',
  googleDriveClientId: 'TU-ID-AQUI.apps.googleusercontent.com',
  licenseApiUrl: ''
};
```

Haz **Commit** en GitHub y recarga la aplicación. Desde ese momento, el botón **Conectar con Google Drive** estará activo para todos tus usuarios.
