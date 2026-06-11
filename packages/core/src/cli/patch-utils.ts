import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Read a JSON file, run a mutator over the parsed object, and write it back
 * (2-space indent + trailing newline) only when the mutator reports a change.
 *
 * The mutator receives the parsed JSON object and returns:
 *  - `true`  → the object was changed, rewrite the file → 'patched'
 *  - `false` → the object already had what we wanted, leave it → 'already'
 *
 * If the file is missing/unreadable, returns 'skipped' and never writes.
 *
 * `parse` lets a caller pre-process the raw text before JSON.parse (e.g. to
 * strip `//` comments from a tsconfig). Defaults to the identity transform.
 */
export function patchJsonFile(
  filePath: string,
  mutator: (json: Record<string, unknown>) => boolean,
  parse: (raw: string) => string = (raw) => raw,
): 'patched' | 'already' | 'skipped' {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return 'skipped';
  }

  const json = JSON.parse(parse(raw)) as Record<string, unknown>;
  if (!mutator(json)) return 'already';

  writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  return 'patched';
}

/**
 * Find the position just after the last import statement in a file.
 * Handles files where the first line starts with `import` (no leading newline).
 */
export function findAfterLastImport(content: string): number {
  // Try \nimport first (import not on the first line)
  const lastImportIndex = content.lastIndexOf('\nimport ');
  if (lastImportIndex !== -1) {
    const endOfLine = content.indexOf('\n', lastImportIndex + 1);
    return endOfLine !== -1 ? endOfLine + 1 : content.length;
  }
  // Fallback: import at the very start of the file
  if (content.startsWith('import ')) {
    const endOfLine = content.indexOf('\n');
    return endOfLine !== -1 ? endOfLine + 1 : content.length;
  }
  return 0;
}

/**
 * Splice an import statement into `content` just after the last existing
 * import. `stmt` must be the bare statement without a trailing newline; a
 * newline is appended. If there is no insertion point (offset 0, i.e. no
 * imports and content doesn't start with `import `), `content` is returned
 * unchanged — matching the original inline guard `if (insertAt > 0)`.
 */
export function insertImport(content: string, stmt: string): string {
  const insertAt = findAfterLastImport(content);
  if (insertAt <= 0) return content;
  return `${content.slice(0, insertAt)}${stmt}\n${content.slice(insertAt)}`;
}
