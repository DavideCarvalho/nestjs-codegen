import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApplyFilter, Widget, createTableController } from './table-factory';

// Bound to a const so the override can reference the factory's products in its
// own decorators — a class cannot reference itself at decoration time. This is
// the shape an override is forced into, so discovery has to follow it.
const WidgetTable = createTableController(Widget);

@Controller('/overridden/search')
export class SearchOverriddenController extends WidgetTable {
  @Post()
  @HttpCode(200)
  // The override must re-declare the filter the base carried, and the only
  // handle on it is the factory's static — a property access, not an importable
  // identifier.
  override async search(
    @ApplyFilter(WidgetTable.filter, { source: 'body' }) queryBuilder: unknown,
    @Body('paginate') paginate: unknown,
  ) {
    void queryBuilder;
    void paginate;
    return { data: [], totalCount: 0 };
  }
}
