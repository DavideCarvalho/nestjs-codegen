---
'@dudousxd/nestjs-codegen': patch
---

Follow relative imports inside declaration files to their declarations: `./chunk.cjs` resolves to `chunk.d.cts` (and `.cts`), `./chunk.mjs` to `chunk.d.mts`, `./chunk.js` to `chunk.d.ts` — after the source candidates, as before. A package's bundled `index.d.cts` imports its chunks by runtime name, and those types came out `unknown`.
