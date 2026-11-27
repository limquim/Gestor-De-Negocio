// Configuración comercial de Gestor Emprendedor — Edición Emprendedores v3 (Local + Drive + Licencias)
const APP_CONFIG = {
  brandName: 'Gestor Emprendedor',
  edition: 'Emprendedores v3 (Local + Drive + Licencias)',

  // Datos de contacto y soporte (aparecen en Política de Privacidad, Acerca de y renovación por WhatsApp)
  // Coloca tu WhatsApp con código de país sin +, ej: '584141234567'
  supportWhatsApp: '+5804124438098',
  supportEmail: 'h.jhosmar14@gmail.com',
  privacyUrl: './privacidad.html',

  // Fase 2: Google Drive OAuth Client ID
  googleDriveClientId: '298894656305-r6n1bjjm2qsmov9fsju32cetv3a9s0i2.apps.googleusercontent.com',

  // Fase 3: Sistema de Licencias ($10/mes) — Modo Offline ECDSA P-256 activo
  licenseEnabled: true,
  trialDays: 14,
  monthlyPriceUsd: 10,
  licensePublicKey: '{"kty":"EC","crv":"P-256","x":"q2HhvRMQEaOMbCZUGqHfbxB8gewlxdoxrF_nQQCDhv8","y":"EXaVET2k2lLZrFV9IdpQFfG8Duus3qfuLa8Tg9sRWMA"}',
  // Opcional (solo si activas Cloudflare Worker más adelante)
  licenseApiUrl: ''
};
