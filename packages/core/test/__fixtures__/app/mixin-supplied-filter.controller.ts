import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  WorkOrder,
  type WorkOrderDto,
  WorkOrderFilter,
  WorkOrderOverrideFilter,
} from './supplied-filter';
import { ApplyFilter } from './table-factory';
import { createTableController } from './table-options-factory';

// A table handed a HAND-WRITTEN filter through the factory's `filter` option.
// The factory still generates its own filter and still decorates both routes
// with it — it has no way to name a class that only exists at this call site —
// so the only record of what actually backs these routes is the option itself.
@Controller('/supplied-filter')
export class SearchSuppliedFilterController extends createTableController({
  entity: WorkOrder,
  filter: WorkOrderFilter,
  dto: { fromEntity: (w: WorkOrder): WorkOrderDto => ({ id: w.id, label: w.title }) },
}) {}

// Bound to a const so the override below can be written at all.
const SuppliedOverrideTable = createTableController({
  entity: WorkOrder,
  filter: WorkOrderFilter,
});

@Controller('/supplied-override')
export class SearchSuppliedOverrideController extends SuppliedOverrideTable {
  @Post()
  @HttpCode(200)
  // The one per-route statement about the filter that can exist: an override
  // naming a filter of its own, by identifier. `distinct` stays inherited, so
  // the two precedence branches are covered by one controller.
  override async search(
    @ApplyFilter(WorkOrderOverrideFilter, { source: 'body' }) queryBuilder: unknown,
    @Body('paginate') paginate: unknown,
  ) {
    void queryBuilder;
    void paginate;
    return { data: [], totalCount: 0 };
  }
}
