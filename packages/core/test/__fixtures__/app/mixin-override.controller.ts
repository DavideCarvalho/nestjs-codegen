import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Widget, createTableController } from './table-factory';

// Bound to a const so the override can reference the factory's products in its
// own decorators — a class cannot reference itself at decoration time. This is
// the shape an override is forced into, so discovery has to follow it.
const WidgetTable = createTableController(Widget);

@Controller('/overridden/search')
export class SearchOverriddenController extends WidgetTable {
  @Post()
  @HttpCode(200)
  override async search(@Body('paginate') paginate: unknown) {
    void paginate;
    void WidgetTable;
    return { data: [], totalCount: 0 };
  }
}
