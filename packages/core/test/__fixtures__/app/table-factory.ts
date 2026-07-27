import { Body, HttpCode, Post } from '@nestjs/common';

// ── Simulated ORM / nestjs-filter decorators (same shape as the real ones) ──
function Property(_opts?: unknown): PropertyDecorator {
  return () => {};
}
function PrimaryKey(_opts?: unknown): PropertyDecorator {
  return () => {};
}
function Filterable(_opts?: unknown): ClassDecorator {
  return () => {};
}
export function ApplyFilter(
  _filterClass: new (...args: unknown[]) => unknown,
  _opts?: { source?: 'body' | 'query' },
): ParameterDecorator {
  return () => {};
}

export class Widget {
  @PrimaryKey()
  id!: string;

  @Property()
  name!: string;
}

export class WidgetDto {
  id!: string;
  label!: string;
}

export interface Paginated<T> {
  data: T[];
  totalCount: number;
}

export interface TableOptions<E, D> {
  dto?: { fromEntity(entity: E): D };
}

/**
 * Mirrors flip's `createTableController`: the HTTP decorators live on a class
 * expression returned from a factory, so they are real AST nodes *here* but not
 * at the `extends createTableController(...)` call site.
 *
 * Note what this makes unresolvable by the ordinary path: `@ApplyFilter` points
 * at a filter class generated per call, and that class's `@Filterable({ entity })`
 * names the factory's own PARAMETER — not a class identifier. The entity is only
 * knowable from the call site, via the route's mixin binding.
 */
export function createTableController<E extends object, D = E>(
  entity: new () => E,
  options: TableOptions<E, D> = {},
) {
  @Filterable({ entity, autoFields: true })
  class GeneratedFilter {}

  class GeneratedTableController {
    // Handed back so a subclass overriding a route can name the generated
    // filter in its own `@ApplyFilter` — it has no importable declaration.
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
