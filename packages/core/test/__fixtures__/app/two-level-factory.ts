import { Body, Get, HttpCode, Post } from '@nestjs/common';
import { ApplyFilter, type Paginated } from './table-factory';

function Filterable(_opts?: unknown): ClassDecorator {
  return () => {};
}

export class ExportRequestDto {
  columns!: string[];
}

export class ExportResultDto {
  url!: string;
}

export class TableHealthDto {
  ok!: boolean;
}

export interface TableFactoryOptions<E extends object> {
  entity: new () => E;
}

/** An ordinary base class — not produced by any factory — that the level-1 factory extends. */
export class TableHealthController {
  @Get('health')
  health(): TableHealthDto {
    return { ok: true };
  }
}

/**
 * Level 1: the shared table factory. Same shape as `table-factory.ts` — the
 * filter it applies is GENERATED per call, and that filter's
 * `@Filterable({ entity })` names the factory's own PARAMETER, so the entity is
 * knowable only from the call site.
 */
export function createTableControllerBase<E extends object>({ entity }: TableFactoryOptions<E>) {
  @Filterable({ entity, autoFields: true })
  class GeneratedFilter {}

  class GeneratedTableBase extends TableHealthController {
    static readonly filter = GeneratedFilter;

    @Post()
    @HttpCode(200)
    async search(
      @ApplyFilter(GeneratedFilter, { source: 'body' }) queryBuilder: unknown,
    ): Promise<Paginated<E>> {
      void queryBuilder;
      return { data: [], totalCount: 0 };
    }
  }
  return GeneratedTableBase;
}

/**
 * Level 2: wraps level 1 and adds one more route as an ORDINARY decorated
 * method. This is how a controller opts into an extra route without every
 * controller extending the shared factory inheriting it: the conditionality is
 * WHICH factory you extend, so nothing has to be mounted imperatively and every
 * route stays statically visible.
 */
export function createExportableTableController<E extends object>(options: TableFactoryOptions<E>) {
  class GeneratedExportable extends createTableControllerBase(options) {
    @Post('export')
    @HttpCode(200)
    async export(@Body() body: ExportRequestDto): Promise<ExportResultDto> {
      void body;
      return { url: '' };
    }
  }
  return GeneratedExportable;
}
