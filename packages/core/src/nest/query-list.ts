import { type ExecutionContext, createParamDecorator } from '@nestjs/common';

/**
 * Normalize a raw query value — `string | string[] | undefined | null` (and, for
 * back-compat with the comma-joined wire format, a comma-separated string) — into
 * a clean `string[]`.
 *
 * Why this exists: Express (and therefore Nest's default query parser) hands back a
 * **bare `string`** when a querystring key carries exactly one value (`?ids=a`), and a
 * `string[]` only when it carries two or more (`?ids=a&ids=b`). `ParseArrayPipe` rejects
 * the single-value form, so the *common* case (one item selected) 400s while the
 * multi-value case passes — an inverted footgun. This helper accepts every shape:
 *
 * - `undefined` / `null`                 → `[]`
 * - `'a'`            (single value)      → `['a']`
 * - `['a', 'b']`     (repeated param)    → `['a', 'b']`
 * - `'a,b'`          (comma-joined wire) → `['a', 'b']`  (see `@dudousxd/nestjs-client`
 *                                          `arrayFormat: 'comma'`, the client default)
 *
 * Empty/whitespace-only entries are dropped. The comma-split is a compatibility fallback:
 * once the client sends `arrayFormat: 'repeat'` (`?ids=a&ids=b`), it degrades to a no-op
 * and only the single-value bare-string case still needs normalizing.
 *
 * Exported standalone so it can back a `class-transformer` `@Transform` on a DTO field
 * (`@Transform(({ value }) => toStringList(value))`) as well as the {@link QueryList}
 * param decorator.
 */
export function toStringList(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(',');
  return arr.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
}

/**
 * Resolve a `string[]` from a request's query param `key` via {@link toStringList}.
 * The seam the {@link QueryList} decorator is built on — exported so callers can reuse
 * the exact resolution in a bespoke `createParamDecorator`. Returns `[]` when no `key`
 * is given (a param decorator cannot infer the target property name).
 */
export function resolveQueryList(key: string | undefined, ctx: ExecutionContext): string[] {
  const request = ctx.switchToHttp().getRequest<{ query?: Record<string, unknown> }>();
  return toStringList(key ? request.query?.[key] : undefined);
}

/**
 * Param decorator that reads an array query param safely, always yielding a clean
 * `string[]` regardless of whether the client sent one value, many, or a comma-joined
 * string. Use it instead of `@Query(key, ParseArrayPipe)` for *optional* array query
 * params:
 *
 * ```ts
 * @Get()
 * list(@QueryList('baseIds') baseIds: string[]) {
 *   // baseIds is always a clean string[] — [] when the param is absent,
 *   // ['a'] for ?baseIds=a, ['a','b'] for ?baseIds=a&baseIds=b or ?baseIds=a,b
 * }
 * ```
 *
 * See {@link toStringList} for the exact normalization and the single-value footgun it
 * closes.
 */
export const QueryList = createParamDecorator(resolveQueryList);
