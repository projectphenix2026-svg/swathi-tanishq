// Copies the built website (web/dist) into pages/dist and adds the _worker.js front door.
import { cpSync, rmSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
rmSync(here('./dist'), { recursive: true, force: true });
cpSync(here('../web/dist'), here('./dist'), { recursive: true });
copyFileSync(here('./_worker.js'), here('./dist/_worker.js'));
console.log('pages/dist ready');
