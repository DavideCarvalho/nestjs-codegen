#!/usr/bin/env node
import { run } from '../dist/cli/main.js';
run(process.argv.slice(2))
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error(`[nestjs-codegen] ${err?.message ?? err}`);
    process.exit(1);
  });
