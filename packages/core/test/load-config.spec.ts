import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/index.js';

describe('loadConfig (native TS config loading)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nestjs-codegen-cfg-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads a .ts config via Node native type-stripping (no tsx required)', async () => {
    // A self-contained TS config: a typed default export with a pass-through
    // validation adapter object, so loadConfig resolves it without importing any
    // external adapter package. This exercises the native-import-first path —
    // on modern Node the file loads with zero dependency on tsx.
    const configSource = `
      const validation = {
        name: 'stub',
        check(): boolean {
          return true;
        },
      };
      const config: { validation: typeof validation } = { validation };
      export default config;
    `;
    await writeFile(join(dir, 'nestjs-codegen.config.ts'), configSource, 'utf8');

    const resolved = await loadConfig(dir);

    expect(resolved.validation).toEqual({ name: 'stub', check: expect.any(Function) });
    expect(resolved.codegen.outDir).toBe(join(dir, '.nestjs-codegen'));
  });

  it('throws a ConfigError when no config file is present', async () => {
    await expect(loadConfig(dir)).rejects.toThrow(/Config file not found/);
  });
});
