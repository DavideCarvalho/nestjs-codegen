import { Controller } from '@nestjs/common';
import { Widget } from './table-factory';
import { createExportableTableController, createTableControllerBase } from './two-level-factory';

/** Opts into the extra route by extending the WRAPPING factory. */
@Controller('widgets')
export class WidgetsController extends createExportableTableController({ entity: Widget }) {}

/** Same table routes, no export route — it extends the inner factory only. */
@Controller('gadgets')
export class GadgetsController extends createTableControllerBase({ entity: Widget }) {}
