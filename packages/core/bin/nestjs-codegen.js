#!/usr/bin/env node
import { run } from '../dist/cli/main.js';
run(process.argv).catch((err) => {
  console.error(`[nestjs-codegen] ${err?.message ?? err}`);
  process.exit(1);
});
