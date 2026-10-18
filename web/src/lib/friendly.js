// Staff see personal details as [Customer name], [Last purchase] … instead of {{name}}.
// The saved message keeps {{name}}; these two functions translate in both directions.
import { VARIABLES } from '@shared/template.js';

const BY_KEY = Object.fromEntries(VARIABLES.map((v) => [v.key, v.label]));
const BY_LABEL = Object.fromEntries(VARIABLES.map((v) => [v.label.toLowerCase(), v.key]));

/** "Hi {{name}}" -> "Hi [Customer name]" */
export function toFriendly(body = '') {
  return body.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (all, key) => (BY_KEY[key] ? `[${BY_KEY[key]}]` : all));
}

/** "Hi [Customer name]" -> "Hi {{name}}"; brackets that are not a known detail stay as typed. */
export function fromFriendly(text = '') {
  return text.replace(/\[([^\]\n]{1,40})\]/g, (all, label) => {
    const key = BY_LABEL[label.trim().toLowerCase()];
    return key ? `{{${key}}}` : all;
  });
}

export const detailLabel = (key) => BY_KEY[key] || key;
