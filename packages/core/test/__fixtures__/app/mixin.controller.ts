import { Controller } from '@nestjs/common';
import { Widget, type WidgetDto, createTableController } from './table-factory';

@Controller('/widgets/search')
export class SearchWidgetsController extends createTableController(Widget, {
  dto: { fromEntity: (w: Widget): WidgetDto => ({ id: w.id, label: w.name }) },
}) {}

@Controller('/gadgets/search')
export class SearchGadgetsController extends createTableController(Widget) {}
