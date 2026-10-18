// Cloudflare Pages front door for https://swathi-tanishq.pages.dev
// Pages serves the website; the API, provider webhooks and health check are passed to the
// swathi-tanishq Worker (service binding API), which also holds D1 and the every-minute Cron.
const TO_WORKER = [/^\/api(\/|$)/, /^\/webhooks(\/|$)/, /^\/health$/];

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (TO_WORKER.some((re) => re.test(pathname))) return env.API.fetch(request);
    return env.ASSETS.fetch(request);
  },
};
