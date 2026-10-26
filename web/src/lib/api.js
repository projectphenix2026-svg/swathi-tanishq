// Small fetch wrapper. The session lives in an httpOnly cookie, so no token is stored in the browser.
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

/** Full address of an API path, for <img>, <video> and links (the session cookie goes with them). */
export const apiUrl = (path) => BASE + path;

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// A request that has not answered by then is given up, so no screen waits forever.
const TIMEOUT_MS = 25000;
const SLOW = 'The server is taking too long to answer. Check your internet connection and try again.';

export async function api(path, { method = 'GET', body, form, timeout = TIMEOUT_MS } = {}) {
  // Never answered from the browser's cache: the data is personal and changes all the time.
  const init = { method, credentials: 'include', headers: {}, cache: 'no-store', signal: AbortSignal.timeout(timeout) };
  if (form) init.body = form;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new ApiError(SLOW, 0);
    throw new ApiError('Cannot reach the server. Check your internet connection and try again.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/auth/login')) onUnauthorized();
  if (!res.ok) throw new ApiError(data.error || `Something went wrong (${res.status}).`, res.status, data);
  return data;
}

export const fileUrl = (path) => `${BASE}${path}`;

/** POST that returns plain text (e.g. a Google Sheet as CSV). Errors come back as JSON. */
export async function apiText(path, body) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new ApiError(SLOW, 0);
    throw new ApiError('Cannot reach the server. Check your internet connection and try again.', 0);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) onUnauthorized();
    throw new ApiError(data.error || `Something went wrong (${res.status}).`, res.status, data);
  }
  return res.text();
}
