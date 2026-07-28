import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApplyFilter, Widget, type WidgetDto } from './table-factory';
import { CustomWidgetFilter, createTableController } from './table-options-factory';

// The entity arrives as a PROPERTY of the single options object, and the class
// it names is declared in another module (imported above) — the normal case.
@Controller('/opt-widgets/search')
export class SearchOptWidgetsController extends createTableController({
  entity: Widget,
  dto: { fromEntity: (w: Widget): WidgetDto => ({ id: w.id, label: w.name }) },
}) {}

// Same call form, bound to a const so the override below can name the factory's
// products in its own decorators. `filter` is a second class-valued property:
// this package never reads it, but `@dudousxd/nestjs-filter-codegen` resolves it
// off the same binding, which is why the properties are keyed by name.
const OptWidgetTable = createTableController({
  entity: Widget,
  filter: CustomWidgetFilter,
});

@Controller('/opt-overridden/search')
export class SearchOptOverriddenController extends OptWidgetTable {
  @Post()
  @HttpCode(200)
  // Overridden route: re-declares the filter the base carried, reachable only as
  // the factory's static. `distinct` stays inherited, so one fixture covers both
  // paths through the binding.
  override async search(
    @ApplyFilter(OptWidgetTable.filter, { source: 'body' }) queryBuilder: unknown,
    @Body('paginate') paginate: unknown,
  ) {
    void queryBuilder;
    void paginate;
    return { data: [], totalCount: 0 };
  }
}
