import { Controller, Get } from '@nestjs/common';
import { PlainBase, makeTableController } from './table-callee-shapes';
import { Widget } from './table-factory';

/**
 * The shape discovery cannot follow: the callee is itself a call. A controller
 * written this way inherits every one of its routes and contributes NONE — the
 * case the warning exists for.
 */
@Controller('/unresolvable/search')
export class SearchUnresolvableController extends makeTableController()(Widget) {}

/**
 * A `@Controller` extending a plain base class — not a factory call at all, and
 * not something to warn about.
 */
@Controller('/plain-base')
export class PlainBaseController extends PlainBase {
  @Get()
  ping(): { ok: boolean } {
    return { ok: true };
  }
}

/**
 * The same unresolvable call on a class that is NOT a controller: legitimate,
 * common, and none of discovery's business.
 */
export class NotAController extends makeTableController()(Widget) {}
