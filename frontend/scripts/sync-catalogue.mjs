// Copies the backend DEMO catalogue into the frontend offline engine at build time.
// The JSON is DEMO DATA (not manufacturer data); see its `disclaimer`.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../backend/app/seed/demo_catalogue.json');
const dst = resolve(here, '../src/engine/demoCatalogue.json');

if (existsSync(src)) {
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.log(`[sync-catalogue] ${src} -> ${dst}`);
} else if (existsSync(dst)) {
  console.log('[sync-catalogue] backend catalogue not found; keeping existing copy');
} else {
  console.error('[sync-catalogue] no catalogue available');
  process.exit(1);
}
