import { Body, HttpCode, Post } from '@nestjs/common';
// `Paginated` is imported rather than redeclared so the response type of this
// factory's routes prints identically to the positional factory's — letting the
// tests assert the two call forms produce the SAME contract, not merely similar
// ones.
import { ApplyFilter, type Paginated } from './table-factory';

// Local copy of the simulated `@Filterable` (the positional fixture keeps its
// own, unexported, so this file can be read on its own).
function Filterable(_opts?: unknown): ClassDecorator {
  return () => {};
}

/** A call-site-supplied filter, passed as `{ filter: CustomWidgetFilter }`. */
export class CustomWidgetFilter {}

export interface TableControllerOptions<E extends object, D> {
  /** The entity the table is built for — the whole point of the named lookup. */
  entity: new () => E;
  dto?: { fromEntity(entity: E): D };
  /**
   * Swapped in at request time by the real factory; the codegens still read the
   * literal `@ApplyFilter(GeneratedFilter)` below, so this is only ever resolved
   * as a call-site class reference on the mixin binding.
   */
  filter?: new (
    ...args: unknown[]
  ) => unknown;
}

/**
 * The SINGLE-OPTIONS-OBJECT call form of a controller factory:
 * `createTableController({ entity: Widget, dto })` rather than
 * `createTableController(Widget, { dto })`.
 *
 * Nothing about the factory body differs from the positional one — the generated
 * filter is still declared before the controller, still handed back as a static
 * so an override can name it, and the controller is still returned by a `return`
 * statement. What differs is entirely at the call site: the only argument is an
 * object literal, so a discovery pass that collects call-site classes by
 * scanning for identifier arguments records NOTHING, and the entity behind
 * `@Filterable({ entity })` becomes unresolvable — which does not degrade the
 * route, it empties it (`filterFields: never`).
 */
export function createTableController<E extends object, D = E>(
  options: TableControllerOptions<E, D>,
) {
  @Filterable({ entity: options.entity, autoFields: true })
  class GeneratedFilter {}

  class GeneratedTableController {
    static readonly filter = GeneratedFilter;

    @Post()
    @HttpCode(200)
    async search(
      @ApplyFilter(GeneratedFilter, { source: 'body' }) queryBuilder: unknown,
      @Body('paginate') paginate: unknown,
    ): Promise<Paginated<D>> {
      void options;
      void queryBuilder;
      void paginate;
      return { data: [], totalCount: 0 };
    }

    @Post('distinct')
    @HttpCode(200)
    async distinct(
      @ApplyFilter(GeneratedFilter, { source: 'body' }) queryBuilder: unknown,
      @Body('distinct') distinct: string[],
    ): Promise<Paginated<Record<string, unknown>>> {
      void queryBuilder;
      void distinct;
      return { data: [], totalCount: 0 };
    }
  }

  return GeneratedTableController;
}
