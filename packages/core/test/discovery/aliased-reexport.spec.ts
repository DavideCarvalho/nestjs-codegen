import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { resolveImportedType } from '../../src/discovery/type-ref-resolution.js';

/**
 * Bundled declaration files (tsup/rollup `.d.ts` chunks) import their types under a
 * mangled alias and re-publish them bare:
 *
 *   import { p as ToolKind } from './tool-CON4ZOrD.cjs';
 *   export { ToolKind };
 *
 * Resolving `ToolKind` through such a file used to match imports by their SOURCE
 * name (`p`), miss, fall back to the file's own `export { ToolKind }` with a fresh
 * cycle guard, and recurse until the stack overflowed.
 */
function project(files: Record<string, string>): Project {
  const p = new Project({ useInMemoryFileSystem: true });
  for (const [path, text] of Object.entries(files)) p.createSourceFile(path, text);
  return p;
}

describe('resolveImportedType through aliased re-exports', () => {
  it('follows `import { p as X }; export { X }` to the declaration', () => {
    const p = project({
      '/lib/chunk.ts': "type ToolKind = 'read' | 'action';\nexport { ToolKind as p };\n",
      '/lib/index.ts': "import { p as ToolKind } from './chunk';\nexport { ToolKind };\n",
      '/app/consumer.ts': "import { ToolKind } from '../lib/index';\nexport type K = ToolKind;\n",
    });
    const consumer = p.getSourceFileOrThrow('/app/consumer.ts');
    const result = resolveImportedType('ToolKind', consumer, p);
    expect(result?.kind).toBe('typeAlias');
    expect(result && 'text' in result ? result.text : undefined).toBe("'read' | 'action'");
  });

  it('gives up instead of recursing when the aliased import leads nowhere', () => {
    const p = project({
      // `./missing.cjs` resolves to no source file the walker can open.
      '/lib/index.ts': "import { p as ToolKind } from './missing.cjs';\nexport { ToolKind };\n",
      '/app/consumer.ts': "import { ToolKind } from '../lib/index';\nexport type K = ToolKind;\n",
    });
    const consumer = p.getSourceFileOrThrow('/app/consumer.ts');
    expect(resolveImportedType('ToolKind', consumer, p)).toBeNull();
  });

  it('still resolves a name a file re-exports twice under different names', () => {
    const p = project({
      '/lib/a.ts': 'export interface Entry { id: string }\n',
      '/lib/index.ts':
        "export { Entry } from './a';\nimport { Entry } from './a';\nexport { Entry as Row };\n",
      '/app/consumer.ts': "import { Row } from '../lib/index';\nexport type R = Row;\n",
    });
    const consumer = p.getSourceFileOrThrow('/app/consumer.ts');
    expect(resolveImportedType('Row', consumer, p)?.kind).toBe('interface');
  });
});
