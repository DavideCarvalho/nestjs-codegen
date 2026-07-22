/**
 * How array-valued query params are serialized on the wire.
 *
 * - `'comma'` (default) joins the elements into a single param with
 *   `Array.prototype.join`, e.g. `{ ids: ['a', 'b'] }` → `?ids=a,b`. This is the
 *   historical behavior and is kept as the default so upgrading is non-breaking.
 * - `'repeat'` emits one param per element, e.g. `?ids=a&ids=b`. This is the form
 *   NestJS's default (Express `qs`) query parser round-trips back into a
 *   `string[]`, so it matches the codegen's generated `Array<string>` contract
 *   without any server-side normalization.
 */
export type ArrayQueryFormat = 'repeat' | 'comma';

export interface BuildUrlOptions {
  params?: Record<string, unknown> | undefined;
  query?: Record<string, unknown> | undefined;
  /**
   * How array-valued query params are serialized. Defaults to `'comma'`
   * (`?ids=a,b`) to preserve existing behavior; pass `'repeat'` for the
   * repeated-param form (`?ids=a&ids=b`) that Nest's array-query parsing expects
   * natively. See {@link ArrayQueryFormat}.
   */
  arrayFormat?: ArrayQueryFormat | undefined;
}

/**
 * Build a URL from a path template, path params, query params, and an optional base URL.
 *
 * Examples:
 *   buildUrl('/users/:id', { params: { id: 42 } })                      → '/users/42'
 *   buildUrl('/users', { query: { active: true } })                     → '/users?active=true'
 *   buildUrl('/users', { query: { ids: ['a', 'b'] } })                  → '/users?ids=a%2Cb'
 *   buildUrl('/users', { query: { ids: ['a', 'b'] }, arrayFormat: 'repeat' }) → '/users?ids=a&ids=b'
 *   buildUrl('/users', {}, 'https://api.test')                          → 'https://api.test/users'
 */
/* v8 ignore next -- function signature default param is not a branch */
export function buildUrl(path: string, opts: BuildUrlOptions = {}, baseUrl?: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  // Interpolate path params — encodeURIComponent prevents path traversal
  // e.g. { id: '../admin' } → '/users/..%2Fadmin' not '/users/../admin'
  let resolved = normalizedPath.replace(/:(\w+)/g, (_match, key: string) => {
    const val = opts.params?.[key];
    if (val === undefined || val === null) {
      throw new Error(`Missing param: ${key}`);
    }
    return encodeURIComponent(String(val));
  });

  const arrayFormat = opts.arrayFormat ?? 'comma';
  const qs = new URLSearchParams();
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        if (arrayFormat === 'repeat') {
          // One param per element (`?k=a&k=b`) — the form Nest's default query
          // parser revives as a `string[]`, matching the generated Array<string>.
          for (const item of v) {
            if (item !== undefined && item !== null) qs.append(k, String(item));
          }
        } else {
          // Single comma-joined param (`?k=a,b`) — `String(array)` is byte-identical
          // to the historical behavior (Array.prototype.toString === join(','), which
          // renders null/undefined elements as empty strings).
          qs.set(k, String(v));
        }
      } else {
        qs.set(k, String(v));
      }
    }
  }
  const qsStr = qs.toString();
  if (qsStr) resolved += `?${qsStr}`;

  if (baseUrl) {
    const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return base + resolved;
  }
  return resolved;
}
