// Configuración comercial de Gestor Emprendedor — Edición Emprendedores v3 (Local + Drive + Licencias)
// Edita estos datos una sola vez con tu marca antes de publicar.
const APP_CONFIG = {
  brandName: 'Gestor Emprendedor',
  edition: 'Emprendedores v3 (Local + Drive + Licencias)',

  // Datos de contacto y soporte (aparecen en la Política de Privacidad, Acerca de y botones de renovación)
  supportWhatsApp: '',   // con código de país, sin +, ej: '584141234567'
  supportEmail: '',      // ej: 'soporte@tudominio.com'
  privacyUrl: './privacidad.html',

  // Fase 2: ID de cliente OAuth de Google Cloud (termina en .apps.googleusercontent.com)
  googleDriveClientId: '',

  // Fase 3: Sistema de Licencias ($10/mes)
  // Cambia licenseEnabled a true cuando ya hayas pegado tu licensePublicKey (generada en admin.html)
  // o tu licenseApiUrl (Cloudflare Worker). Mientras sea false, la app funciona en modo libre sin bloqueo.
  licenseEnabled: false,
  trialDays: 14,          // Días de prueba gratis automáticos para nuevos usuarios
  monthlyPriceUsd: 10,    // Precio mensual mostrado en pantalla de suscripción
  // Llave pública ECDSA P-256 (JWK en JSON o Base64url) generada con 1 clic en admin.html. Es seguro publicarla aquí.
  licensePublicKey: '',
  // Opcional (recomendado para renovación/suspensión remota): URL de tu worker_licencias.js en Cloudflare Workers
  // Ejemplo: 'https://licencias-gestor.tuusuario.workers.dev' (sin barra al final)
  licenseApiUrl: ''
};
