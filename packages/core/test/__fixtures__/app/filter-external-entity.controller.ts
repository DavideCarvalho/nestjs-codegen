// Entity imported from an EXTERNAL npm package (resolves to a node_modules
// `.d.ts`), NOT an in-repo `*.entity.ts`. This is the regression case: the
// codegen must still classify the route as a filter route and enumerate the
// entity's columns from the declaration file.
import { WorkflowRunEntity } from '@ext/durable-store-mikro-orm';
import { Controller, Get } from '@nestjs/common';

function Filterable(_opts?: unknown): ClassDecorator {
  return () => {};
}
function ApplyFilter(_filterClass: new (...args: unknown[]) => unknown): ParameterDecorator {
  return () => {};
}

@Filterable({ entity: WorkflowRunEntity, autoFields: true })
export class WorkflowRunFilter {}

@Controller('/api/workflow-runs')
export class FilterExternalEntityController {
  @Get()
  list(@ApplyFilter(WorkflowRunFilter) _qb: unknown) {
    return [];
  }
}
