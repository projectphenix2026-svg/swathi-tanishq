// Cloudflare Pages front door for https://swathi-tanishq.pages.dev
// Pages serves the website; the API, provider webhooks and health check are passed to the
// swathi-tanishq Worker (service binding API), which also holds D1 and the every-minute Cron.
const TO_WORKER = [/^\/api(\/|$)/, /^\/webhooks(\/|$)/, /^\/media\//, /^\/health$/];

// Browser protections for the website itself (the API sets its own):
// only this site's scripts run, the app cannot be framed by another site (clickjacking),
// HTTPS always, and no camera, microphone or location access.
export const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; '),
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

// The "Reconnect the shop's WhatsApp number" page is the only one that loads Facebook's script
// (for Meta's pop-up), so only that page allows it.
export const CONNECT_PAGE = /^\/connect-whatsapp(\.html|\.js)?$/;
export const CONNECT_PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self' https://*.facebook.com https://*.facebook.net",
  'frame-src https://*.facebook.com https://facebook.com',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (TO_WORKER.some((re) => re.test(pathname))) return env.API.fetch(request);
    const asset = await env.ASSETS.fetch(request);
    const res = new Response(asset.body, asset);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
    if (CONNECT_PAGE.test(pathname)) res.headers.set('Content-Security-Policy', CONNECT_PAGE_CSP);
    return res;
  },
};
