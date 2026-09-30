import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import {
  resolveImportedType,
  resolveModuleSpecifier,
} from '../../src/discovery/type-ref-resolution.js';

/**
 * A package's bundled declarations import their chunks by the RUNTIME file name —
 * `./tool-X.cjs` from `index.d.cts`, `./tool-X.js` from `index.d.ts`, `./tool-X.mjs`
 * from `index.d.mts` — and the types live beside them in the matching declaration
 * file. Following only `.ts` left those types `unknown`.
 */
function project(files: Record<string, string>): Project {
  const p = new Project({ useInMemoryFileSystem: true });
  for (const [path, text] of Object.entries(files)) p.createSourceFile(path, text);
  return p;
}

const KIND = "type ToolKind = 'read' | 'action';\nexport { ToolKind as p };\n";

function kindThrough(chunk: string, specifier: string, index: string) {
  const p = project({
    [chunk]: KIND,
    [index]: `import { p as ToolKind } from '${specifier}';\nexport { ToolKind };\n`,
  });
  return resolveImportedType('ToolKind', p.getSourceFileOrThrow(index), p);
}

describe('relative imports inside declaration files', () => {
  it('follows `./chunk.cjs` to `chunk.d.cts`', () => {
    const result = kindThrough('/lib/tool-X.d.cts', './tool-X.cjs', '/lib/index.d.cts');
    expect(result && 'text' in result ? result.text : undefined).toBe("'read' | 'action'");
  });

  it('follows `./chunk.mjs` to `chunk.d.mts`', () => {
    const result = kindThrough('/lib/tool-X.d.mts', './tool-X.mjs', '/lib/index.d.mts');
    expect(result && 'text' in result ? result.text : undefined).toBe("'read' | 'action'");
  });

  it('follows `./chunk.js` to `chunk.d.ts`', () => {
    const result = kindThrough('/lib/tool-X.d.ts', './tool-X.js', '/lib/index.d.ts');
    expect(result && 'text' in result ? result.text : undefined).toBe("'read' | 'action'");
  });

  it('still prefers a source file, and keeps the extensionless and index forms', () => {
    const p = project({ '/a/x.ts': '' });
    const file = p.getSourceFileOrThrow('/a/x.ts');
    const candidates = resolveModuleSpecifier('./y.js', file, p);
    expect(candidates[0]).toBe('/a/y.ts');
    expect(candidates).toContain('/a/y.d.ts');
    expect(resolveModuleSpecifier('./y', file, p)).toEqual(
      expect.arrayContaining(['/a/y.ts', '/a/y/index.ts', '/a/y.d.ts']),
    );
    expect(resolveModuleSpecifier('./y.cjs', file, p)).toEqual(
      expect.arrayContaining(['/a/y.cts', '/a/y.d.cts']),
    );
  });
});
