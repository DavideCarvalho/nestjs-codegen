// Keeps each package's exported `VERSION` constant in lock-step with its
// package.json version. Run automatically as part of `changeset version`
// (see the root `changeset:version` script and the CI changesets action),
// so a bump never drifts from the hardcoded literal and breaks the smoke test.
//
// We can't simply `import pkg from '../package.json'` inside src/ because the
// packages compile with `rootDir: "src"`, which forbids importing files above
// it. Rewriting the literal sidesteps that while staying a plain const.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Packages whose `src/index.ts` exports `export const VERSION = '…';`.
const PACKAGES = ['core', 'client'];

const VERSION_RE = /export const VERSION = '[^']*';/;

let changed = 0;
for (const pkg of PACKAGES) {
  const pkgJsonPath = join(root, 'packages', pkg, 'package.json');
  const indexPath = join(root, 'packages', pkg, 'src', 'index.ts');

  const { version } = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const src = readFileSync(indexPath, 'utf8');

  if (!VERSION_RE.test(src)) {
    throw new Error(`sync-version: no \`export const VERSION\` found in ${indexPath}`);
  }

  const next = src.replace(VERSION_RE, `export const VERSION = '${version}';`);
  if (next !== src) {
    writeFileSync(indexPath, next);
    console.log(`sync-version: ${pkg} VERSION -> ${version}`);
    changed++;
  } else {
    console.log(`sync-version: ${pkg} VERSION already ${version}`);
  }
}

console.log(`sync-version: ${changed} file(s) updated`);
