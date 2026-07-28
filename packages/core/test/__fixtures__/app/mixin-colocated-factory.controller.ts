import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { WorkOrder, WorkOrderFilter, WorkOrderOverrideFilter } from './supplied-filter';
import { ApplyFilter, type Paginated } from './table-factory';

// Local copy of the simulated `@Filterable`, so this file stands on its own.
function Filterable(_opts?: unknown): ClassDecorator {
  return () => {};
}

/**
 * A controller factory declared in the SAME FILE as a controller that calls it.
 *
 * Unusual but legal, and the one shape that separates "is this route an
 * override?" from "is this method's file the factory's file?". Every other
 * fixture imports its factory, so the two questions happen to have the same
 * answer and a file comparison passes for the wrong reason.
 */
export function createColocatedTableController<E extends object>(options: {
  entity: new () => E;
  filter?: new (...args: unknown[]) => unknown;
}) {
  @Filterable({ entity: options.entity, autoFields: true })
  class GeneratedFilter {}

  class GeneratedTableController {
    static readonly filter = GeneratedFilter;

    @Post()
    @HttpCode(200)
    async search(
      @ApplyFilter(GeneratedFilter, { source: 'body' }) queryBuilder: unknown,
      @Body('paginate') paginate: unknown,
    ): Promise<Paginated<E>> {
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

// Bound to a const so the override below can name the table at all.
const ColocatedTable = createColocatedTableController({
  entity: WorkOrder,
  filter: WorkOrderFilter,
});

@Controller('/colocated')
export class SearchColocatedController extends ColocatedTable {
  @Post()
  @HttpCode(200)
  // An override naming a filter of its own, by identifier — the most specific
  // statement about this one route, and it must outrank the factory's `filter`
  // option. `distinct` stays inherited, so one controller covers both branches.
  override async search(
    @ApplyFilter(WorkOrderOverrideFilter, { source: 'body' }) queryBuilder: unknown,
    @Body('paginate') paginate: unknown,
  ) {
    void queryBuilder;
    void paginate;
    return { data: [], totalCount: 0 };
  }
}
