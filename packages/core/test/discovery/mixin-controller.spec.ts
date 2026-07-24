import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverContractsFast } from '../../src/discovery/contracts-fast.js';

const FIXTURES = join(__dirname, '..', '__fixtures__', 'app');

describe('mixin controller discovery', () => {
  it('discovers routes inherited from a factory-produced base class', async () => {
    const routes = await discoverContractsFast({
      cwd: FIXTURES,
      glob: 'mixin.controller.ts',
    });
    const paths = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(paths).toEqual([
      'POST /gadgets/search',
      'POST /gadgets/search/distinct',
      'POST /widgets/search',
      'POST /widgets/search/distinct',
    ]);
  });
});
