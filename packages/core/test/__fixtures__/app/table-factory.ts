import { Body, HttpCode, Post } from '@nestjs/common';

export class Widget {
  id!: string;
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
 */
export function createTableController<E extends object, D = E>(
  entity: new () => E,
  options: TableOptions<E, D> = {},
) {
  class GeneratedTableController {
    @Post()
    @HttpCode(200)
    async search(@Body('paginate') paginate: unknown): Promise<Paginated<D>> {
      void entity;
      void options;
      void paginate;
      return { data: [], totalCount: 0 };
    }

    @Post('distinct')
    @HttpCode(200)
    async distinct(
      @Body('distinct') distinct: string[],
    ): Promise<Paginated<Record<string, unknown>>> {
      void distinct;
      return { data: [], totalCount: 0 };
    }
  }

  return GeneratedTableController;
}
