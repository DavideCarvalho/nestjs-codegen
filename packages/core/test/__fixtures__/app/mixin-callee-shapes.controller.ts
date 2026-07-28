import { Controller } from '@nestjs/common';
import { TableFactory, factories, shorthand } from './table-callee-shapes';
import { Widget } from './table-factory';

/** Static method on a class. */
@Controller('/static/search')
export class SearchStaticController extends TableFactory.create(Widget) {}

/** Property of a re-export object. */
@Controller('/reexported/search')
export class SearchReexportedController extends factories.table(Widget) {}

/** Shorthand property of a re-export object. */
@Controller('/shorthand/search')
export class SearchShorthandController extends shorthand.createTableController(Widget) {}
