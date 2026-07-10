/**
 * Zero-dependency decorators consumed by `@dudousxd/nestjs-codegen`'s static AST
 * scan. Import from the `@dudousxd/nestjs-codegen/markers` subpath (NOT the
 * package root) so a controller can use them without pulling in the generator,
 * ts-morph, or any of the codegen CLI/Nest-module machinery.
 *
 * Every export here is a runtime no-op: the decorator does nothing when the
 * app actually runs. Its only job is to be a stable, statically-detectable AST
 * shape (`@AsQuery()` on a method) that codegen's discovery pass looks for.
 */

/**
 * Marks a non-GET route whose semantics are a READ (e.g. a `POST` endpoint that
 * accepts a query-shaped payload) so codegen emits `queryOptions` for it —
 * exactly like a GET or a filter-search route — instead of only
 * `mutationOptions`. Detected statically by codegen's AST scan; does nothing at
 * runtime.
 *
 * @example
 * ```ts
 * import { AsQuery } from '@dudousxd/nestjs-codegen/markers';
 *
 * @Controller('reports')
 * class ReportsController {
 *   @Post('search')
 *   @AsQuery()
 *   search(@Body() body: SearchDto) { ... }
 * }
 * ```
 */
export function AsQuery(): MethodDecorator {
  return () => {
    // No-op at runtime — codegen detects the decorator statically via AST scan.
  };
}
