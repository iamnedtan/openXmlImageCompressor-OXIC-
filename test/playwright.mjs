// Playwright is installed globally in some environments and locally in others.
// ESM `import` ignores NODE_PATH, so resolve through require, which doesn't.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CANDIDATES = ['playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright'];

export function loadPlaywright() {
  for (const id of CANDIDATES) {
    try { return require(id); } catch { /* try the next one */ }
  }
  throw new Error(
    'Playwright not found. Install it with `npm i -D playwright`, or run with\n' +
    '  NODE_PATH=/opt/node22/lib/node_modules node <script>');
}
