// Lists the English text the screens show, so it can be translated (run: node web/scripts/extract-text.mjs).
// Collects JSX text, common text props (placeholder, title, label, hint, aria-label), and the
// first argument of t() and toast(). Text with ${...} parts is listed separately as patterns.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;
const root = fileURLToPath(new URL('../src/', import.meta.url));
const PROPS = new Set(['placeholder', 'title', 'label', 'hint', 'aria-label', 'caption', 'text']);
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.jsx$/.test(f)) files.push(p);
  }
})(root);

const texts = new Map(); // text -> files
const patterns = new Map();
const add = (map, s, file) => {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t || !/[A-Za-z]{2}/.test(t) || /^[\w.-]+$/.test(t) && !/\s/.test(t) && t.length < 3) return;
  if (/^(https?:|\/|#|\{\{|[a-z_]+:)/.test(t)) return;
  if (!map.has(t)) map.set(t, new Set());
  map.get(t).add(relative(root, file));
};

for (const file of files) {
  const code = readFileSync(file, 'utf8');
  const ast = parse(code, { sourceType: 'module', plugins: ['jsx'] });
  traverse(ast, {
    JSXText(p) { add(texts, p.node.value, file); },
    JSXAttribute(p) {
      const name = p.node.name.name;
      const v = p.node.value;
      if (!PROPS.has(name) || !v) return;
      if (v.type === 'StringLiteral') add(texts, v.value, file);
      if (v.type === 'JSXExpressionContainer' && v.expression.type === 'StringLiteral') add(texts, v.expression.value, file);
      if (v.type === 'JSXExpressionContainer' && v.expression.type === 'TemplateLiteral') add(patterns, v.expression.quasis.map((q) => q.value.cooked).join('{x}'), file);
    },
    CallExpression(p) {
      const callee = p.node.callee;
      const name = callee.type === 'Identifier' ? callee.name : null;
      const arg = p.node.arguments[0];
      if (!['t', 'toast'].includes(name) || !arg) return;
      if (arg.type === 'StringLiteral') add(texts, arg.value, file);
      if (arg.type === 'TemplateLiteral') add(patterns, arg.quasis.map((q) => q.value.cooked).join('{x}'), file);
    },
    // Any other sentence-like string (in ternaries, lists, error texts): starts with a capital or
    // is several words, and is not a class name, path or code.
    StringLiteral(p) {
      const v = p.node.value;
      const parent = p.parent;
      if (parent.type === 'ImportDeclaration' || parent.type === 'ExportNamedDeclaration') return;
      if (parent.type === 'JSXAttribute' && !PROPS.has(parent.name.name)) return;
      if (parent.type === 'ObjectProperty' && parent.key === p.node) return;
      if (/^[a-z_-]+$/.test(v) || /^[\w.-]+\.(svg|png|js|jsx|css)$/.test(v) || /[{}<>=]|^\/|^#|^https?:/.test(v)) return;
      if (/^[A-Z]/.test(v) ? /[a-z]/.test(v) : /\s/.test(v) && /[a-z]{3}/.test(v)) add(texts, v, file);
    },
    ObjectProperty(p) {
      // { title: '…', text: '…', label: '…' } in lists of options and steps.
      const k = p.node.key.name || p.node.key.value;
      if (['title', 'text', 'label', 'hint', 'one', 'action'].includes(k) && p.node.value.type === 'StringLiteral') add(texts, p.node.value.value, file);
    },
  });
}

const out = { texts: [...texts.keys()].sort(), patterns: [...patterns.keys()].sort() };
writeFileSync(process.argv[2] || 'screen-text.json', JSON.stringify(out, null, 1));
console.log(`${out.texts.length} texts, ${out.patterns.length} patterns`);
