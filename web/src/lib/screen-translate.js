// Puts every screen in the person's language: each piece of English text on the page (and the
// placeholder, title and aria-label of fields and buttons) is swapped for its Telugu or Hindi
// version from the dictionary, also when React adds or changes text later. Customer messages
// (previews, chat bubbles, template text) are never touched. English shows the text as written.
const SKIP = '.bubble, .phone, .tpl-text, .sms-bubble, .wa-btn, code, pre, textarea, input, select, option, [data-no-translate]';
const ATTRS = ['placeholder', 'title', 'aria-label'];
const NUMBERED = /^([₹+\-–]?[\d,.]+%?)\s+(.+)$/s;

let observer = null;
let dict = {};
let lower = {};
const original = new WeakMap(); // text node -> English text it showed before translating
const translated = new Set(); // text nodes and elements changed, so English can be put back

function lookup(core) {
  if (dict[core]) return dict[core];
  if (lower[core.toLowerCase()]) return lower[core.toLowerCase()];
  // "8 customers", "₹7.77 to WhatsApp": a number, then words we know.
  const m = core.match(NUMBERED);
  if (m) {
    const rest = dict[m[2]] || lower[m[2].toLowerCase()];
    if (rest) return `${m[1]} ${rest}`;
  }
  return null;
}

function swap(text) {
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m[2] || !/[A-Za-z]/.test(m[2])) return null;
  const t = lookup(m[2]);
  return t ? `${m[1]}${t}${m[3]}` : null;
}

const skipped = (el) => !el || Boolean(el.closest(SKIP));

function textNode(node) {
  if (skipped(node.parentElement)) return;
  const now = node.nodeValue;
  // React may have written new English since we translated: that is the new original.
  const done = original.has(node) && translated.has(node) ? node.__shown : null;
  if (done !== null && now === done) return;
  const t = swap(now);
  if (t === null) return;
  original.set(node, now);
  node.__shown = t;
  translated.add(node);
  node.nodeValue = t;
}

function element(el) {
  if (skipped(el) && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
  if (el.closest('[data-no-translate]')) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const key = `data-en-${a}`;
    const shown = el.getAttribute(`data-shown-${a}`);
    if (shown === v) continue;
    const t = swap(v);
    if (t === null) continue;
    el.setAttribute(key, v);
    el.setAttribute(`data-shown-${a}`, t);
    el.setAttribute(a, t);
    translated.add(el);
  }
}

function walk(root) {
  if (root.nodeType === Node.TEXT_NODE) return textNode(root);
  if (root.nodeType !== Node.ELEMENT_NODE) return undefined;
  element(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) textNode(n);
    else element(n);
  }
  return undefined;
}

/** Puts the English back everywhere it was replaced. */
function restore() {
  for (const n of translated) {
    if (n.nodeType === Node.TEXT_NODE) {
      if (n.nodeValue === n.__shown) n.nodeValue = original.get(n);
      delete n.__shown;
    } else {
      for (const a of ATTRS) {
        const en = n.getAttribute(`data-en-${a}`);
        if (en !== null && n.getAttribute(a) === n.getAttribute(`data-shown-${a}`)) n.setAttribute(a, en);
        n.removeAttribute(`data-en-${a}`);
        n.removeAttribute(`data-shown-${a}`);
      }
    }
  }
  translated.clear();
}

/** Starts (or switches, or stops for English) translating the whole page. */
export function translateScreens(words) {
  observer?.disconnect();
  observer = null;
  restore();
  dict = words || {};
  lower = Object.fromEntries(Object.entries(dict).map(([k, v]) => [k.toLowerCase(), v]));
  if (!words || !Object.keys(words).length || typeof document === 'undefined') return;
  walk(document.body);
  observer = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') textNode(m.target);
      else if (m.type === 'attributes') element(m.target);
      else m.addedNodes.forEach(walk);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
