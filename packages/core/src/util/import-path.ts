import { relative } from 'node:path';

/**
 * Build a module specifier from `outDir` to `filePath`, suitable for emitting
 * into generated `import(...)` / `import ... from` statements.
 *
 * Node's `path.relative` uses the platform separator, so on Windows it returns
 * backslashes (`..\\..\\pages\\Foo`). TypeScript/bundlers expect POSIX-style
 * forward slashes in import specifiers, so we always normalize. This keeps the
 * generated client identical across macOS, Linux, and Windows.
 *
 * @param stripExt - optional extension matcher removed from the tail (e.g. `.ts`)
 */
export function toImportSpecifier(outDir: string, filePath: string, stripExt?: RegExp): string {
  let spec = relative(outDir, filePath);
  if (stripExt) spec = spec.replace(stripExt, '');
  spec = spec.replace(/\\/g, '/');
  if (!spec.startsWith('.')) spec = `./${spec}`;
  return spec;
}
