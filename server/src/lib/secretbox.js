// Encrypts small secrets (the shop's WhatsApp key) before they are stored in the database.
// AES-256-GCM with a key derived (HKDF) from SETTINGS_KEY, or JWT_SECRET when that is not set.
// WebCrypto only, so it runs the same in Node and on Cloudflare Workers.
import { config } from '../config.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
let keyPromise = null;

function b64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

function key() {
  keyPromise ??= (async () => {
    const material = await crypto.subtle.importKey('raw', enc.encode(config.settingsKey || config.jwtSecret), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('swathi-tanishq'), info: enc.encode('whatsapp-connection') },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  })();
  return keyPromise;
}

/** "iv.ciphertext" in base64; null stays null. */
export async function seal(text) {
  if (text == null || text === '') return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), enc.encode(String(text)));
  return `${b64(iv)}.${b64(data)}`;
}

/** Returns the text, or null when missing or when it cannot be opened (e.g. the key changed). */
export async function open(sealed) {
  if (!sealed) return null;
  try {
    const [iv, data] = sealed.split('.');
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(), unb64(data)));
  } catch {
    return null;
  }
}

/** For tests: forget the derived key (after changing the secret). */
export function resetSecretbox() {
  keyPromise = null;
}
