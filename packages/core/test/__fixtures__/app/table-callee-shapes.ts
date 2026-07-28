import { Body, HttpCode, Post } from '@nestjs/common';
// `Paginated` and `ApplyFilter` are imported rather than redeclared so these
// factories produce contracts that print identically to the plain one — the
// tests can then assert the callee SHAPE is what changed, nothing else.
import { ApplyFilter, type Paginated, createTableController } from './table-factory';

// Local copy of the simulated `@Filterable` (the plain fixture keeps its own,
// unexported, so this file can be read on its own).
function Filterable(_opts?: unknown): ClassDecorator {
  return () => {};
}

/**
 * A controller factory published as a STATIC METHOD — `TableFactory.create(Entity)`.
 *
 * Body identical in structure to the standalone factory: a filter generated per
 * call, handed back as a static, and a controller class returned by a `return`
 * statement. Only the callee at the extends site differs.
 */
export class TableFactory {
  static create<E extends object>(entity: new () => E) {
    @Filterable({ entity, autoFields: true })
    class GeneratedFilter {}

    class GeneratedTableController {
      static readonly filter = GeneratedFilter;

      @Post()
      @HttpCode(200)
      async search(
        @ApplyFilter(GeneratedFilter, { source: 'body' }) queryBuilder: unknown,
        @Body('paginate') paginate: unknown,
      ): Promise<Paginated<E>> {
        void queryBuilder;
        void paginate;
        return { data: [], totalCount: 0 };
      }
    }

    return GeneratedTableController;
  }
}

/**
 * A factory re-exported through an OBJECT LITERAL — `factories.table(Entity)`.
 *
 * The property assignment is the only declaration `table` has; the function is
 * one identifier further on.
 */
export const factories = { table: createTableController };

/** The same, written as a shorthand property — `shorthand.createTableController(Entity)`. */
export const shorthand = { createTableController };

/**
 * Deliberately UNRESOLVABLE: naming the function behind `makeTableController()(Entity)`
 * would mean evaluating the program, so discovery must refuse — loudly.
 */
export function makeTableController() {
  return createTableController;
}

/** A plain base class, so a `@Controller` can extend something that is not a call. */
export class PlainBase {}
