// All settings come from environment variables (see .env.example).
// Nothing secret is hard-coded here.
const env = process.env;

function bool(v, fallback) {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

export const config = {
  port: Number(env.PORT || 4000),
  nodeEnv: env.NODE_ENV || 'development',
  // Public URL of this API, used for provider status callbacks (e.g. a tunnel URL locally).
  publicBaseUrl: (env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  // Front-end origin allowed to call the API with cookies.
  webOrigin: env.WEB_ORIGIN || 'http://localhost:5173',

  jwtSecret: env.JWT_SECRET || '',
  adminEmail: env.ADMIN_EMAIL || '',
  adminPassword: env.ADMIN_PASSWORD || '',
  adminName: env.ADMIN_NAME || 'Admin',
  businessName: env.BUSINESS_NAME || 'Swathi Tanishq',

  // Empty DATABASE_URL = embedded Postgres (PGlite) stored in PGLITE_DIR.
  databaseUrl: env.DATABASE_URL || '',
  pgliteDir: env.PGLITE_DIR || './.data/pglite',

  // Empty REDIS_URL = in-process queue (fine for one machine / development).
  redisUrl: env.REDIS_URL || '',

  // mock | twilio | meta
  provider: (env.MESSAGING_PROVIDER || 'mock').toLowerCase(),
  costPerMessage: Number(env.COST_PER_MESSAGE_INR || 0.8631),
  sendRatePerSecond: Number(env.SEND_RATE_PER_SECOND || 5),
  maxAttempts: Number(env.SEND_MAX_ATTEMPTS || 4),
  validateWebhooks: bool(env.VALIDATE_WEBHOOK_SIGNATURES, true),
  // How often to ask the provider for status of recent messages (0 = off).
  // Covers local development, where the provider cannot reach our webhook.
  statusPollSeconds: Number(env.STATUS_POLL_SECONDS ?? 20),

  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID || '',
    authToken: env.TWILIO_AUTH_TOKEN || '',
    whatsappFrom: env.TWILIO_WHATSAPP_FROM || '',
  },
  meta: {
    accessToken: env.META_ACCESS_TOKEN || '',
    phoneNumberId: env.META_PHONE_NUMBER_ID || '',
    appSecret: env.META_APP_SECRET || '',
    verifyToken: env.META_WEBHOOK_VERIFY_TOKEN || '',
    graphVersion: env.META_GRAPH_VERSION || 'v25.0',
    // WhatsApp Business account ID: needed to submit templates for approval.
    wabaId: env.META_WABA_ID || '',
  },

  // SMS backup. Until DLT registration is approved, SMS_MODE=preview records the
  // exact SMS that would go out without sending it.
  sms: {
    mode: (env.SMS_MODE || 'preview').toLowerCase(), // preview | msg91
    msg91AuthKey: env.MSG91_AUTH_KEY || '',
    senderId: env.MSG91_SENDER_ID || '',
    costPerSms: Number(env.SMS_COST_INR || 0.25),
  },

  // How often the occasion scheduler checks for birthdays, anniversaries and festivals.
  occasionCheckMinutes: Number(env.OCCASION_CHECK_MINUTES ?? 15),
};

export function assertConfig() {
  if (!config.jwtSecret || config.jwtSecret.length < 16) {
    if (config.nodeEnv === 'production') throw new Error('JWT_SECRET must be set (16+ characters).');
    console.warn('[config] JWT_SECRET not set: using a development-only secret.');
    config.jwtSecret = 'dev-only-secret-change-me-please';
  }
}
