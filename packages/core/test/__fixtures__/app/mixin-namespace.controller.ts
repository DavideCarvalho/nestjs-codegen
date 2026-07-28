import { Controller } from '@nestjs/common';
import { Widget } from './table-factory';
import * as tables from './table-factory';

/**
 * Namespace import — the factory is reached through the module object.
 *
 * Kept in its own file: the checker prints a type as the file can NAME it, so a
 * namespace import turns every response type in the file into `tables.X`. Mixing
 * it with the other callee shapes would make their contracts diverge from the
 * bare-identifier baseline for a reason that has nothing to do with the callee.
 */
@Controller('/namespaced/search')
export class SearchNamespacedController extends tables.createTableController(Widget) {}
