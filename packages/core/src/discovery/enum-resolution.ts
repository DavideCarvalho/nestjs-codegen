import type { Project, SourceFile } from 'ts-morph';
import { findType } from './type-ref-resolution.js';

/**
 * Resolve an enum identifier to its raw member values + numeric flag.
 *
 * KNOWN LIMITATION — mixed enums with a computed member: `findType` serializes
 * each enum member with `JSON.stringify` of its static value, falling back to the
 * QUOTED member NAME for any member whose value can't be resolved statically
 * (e.g. a computed member). Here we re-derive `numeric` by `JSON.parse`-ing each
 * member: any string member (including that quoted-name fallback) flips `numeric`
 * to `false` for the WHOLE enum. So a primarily-numeric enum that contains a
 * single computed member is treated as a string enum, and its numeric members
 * are emitted as quoted string literals. This is a rare edge case; fixing it
 * would require threading per-member numeric-ness out of `findType` rather than
 * inferring it from the stringified members. Pure numeric and pure string enums
 * (the overwhelmingly common cases) are unaffected.
 */
type EnumResult = { values: string[]; numeric: boolean };

/**
 * Per-`Project` memoization of {@link resolveEnumValues}. Same WeakMap-by-Project
 * safety as `findType`: each discovery run (and each watch change) builds a fresh
 * `Project`, so the cache dies with it and never goes stale. Null results are
 * cached too (via `.has`). Returns a copy on a cache hit so callers never share a
 * mutable `values` array.
 */
const _enumCache = new WeakMap<Project, Map<string, EnumResult | null>>();

/**
 * Evict the per-`Project` enum cache. Companion to
 * `clearTypeResolutionCaches` — the persistent watch-mode Project must drop this
 * on every change or a changed enum would resolve to stale members.
 */
export function clearEnumCache(project: Project): void {
  _enumCache.delete(project);
}

export function resolveEnumValues(
  name: string,
  sourceFile: SourceFile,
  project: Project,
): EnumResult | null {
  let byKey = _enumCache.get(project);
  if (byKey === undefined) {
    byKey = new Map();
    _enumCache.set(project, byKey);
  }
  const key = `${sourceFile.getFilePath()}\0${name}`;
  if (byKey.has(key)) {
    const cached = byKey.get(key) ?? null;
    return cached ? { values: [...cached.values], numeric: cached.numeric } : null;
  }

  const resolved = findType(name, sourceFile, project);
  let result: EnumResult | null = null;
  if (resolved && resolved.kind === 'enum') {
    // members are JSON.stringify'd ("A" / "0"); strip quotes to raw values.
    let numeric = true;
    const values = resolved.members.map((m) => {
      const parsed = JSON.parse(m) as string | number;
      if (typeof parsed === 'string') numeric = false;
      return String(parsed);
    });
    if (values.length > 0) result = { values, numeric };
  }
  byKey.set(key, result);
  return result ? { values: [...result.values], numeric: result.numeric } : null;
}
