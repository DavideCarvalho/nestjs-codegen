import { afterEach, describe, expect, it, vi } from 'vitest';

describe('toImportSpecifier', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('node:path');
  });

  it('produces a relative specifier with a "./" prefix and strips the extension', async () => {
    const { toImportSpecifier } = await import('../../src/util/import-path.js');
    expect(toImportSpecifier('/app/.gen', '/app/src/foo.controller.ts', /\.ts$/)).toBe(
      '../src/foo.controller',
    );
    // Sibling file resolves to an explicit "./" prefix.
    expect(toImportSpecifier('/app/src', '/app/src/foo.ts', /\.ts$/)).toBe('./foo');
  });

  it('normalizes Windows backslash separators to POSIX forward slashes', async () => {
    // Simulate Node running on Windows, where path.relative returns backslashes.
    const actual = await vi.importActual<typeof import('node:path')>('node:path');
    vi.doMock('node:path', () => ({
      ...actual,
      relative: () => '..\\..\\pages\\Auth\\Login.tsx',
    }));
    const { toImportSpecifier } = await import('../../src/util/import-path.js');

    const spec = toImportSpecifier('C:\\app\\.gen', 'C:\\app\\pages\\Auth\\Login.tsx', /\.tsx$/);
    expect(spec).toBe('../../pages/Auth/Login');
    expect(spec).not.toContain('\\');
  });
});
