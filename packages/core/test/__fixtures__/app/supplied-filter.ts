// Entities + hand-written filter classes for the "filter supplied to the
// factory" fixture. Kept in their own module (rather than inline in the
// controller) because that is how a real app writes them: the filter is an
// importable class, which is the whole reason it can be handed to a factory.

function Property(_opts?: unknown): PropertyDecorator {
  return () => {};
}
function PrimaryKey(_opts?: unknown): PropertyDecorator {
  return () => {};
}
function Filterable(_opts?: unknown): ClassDecorator {
  return () => {};
}
function FilterFor(_key: string, _opts?: unknown): MethodDecorator {
  return () => {};
}

/** The entity the TABLE is built for — `createTableController({ entity: WorkOrder })`. */
export class WorkOrder {
  @PrimaryKey()
  id!: string;

  @Property()
  title!: string;

  @Property()
  secret!: string;
}

/**
 * The entity the hand-written filter declares for itself: a read projection over
 * the same rows. Deliberately NOT the table's entity, so a test can tell which
 * of the two the emitted fields came from.
 */
export class WorkOrderView {
  @PrimaryKey()
  id!: string;

  @Property()
  auditedBy!: string;

  @Property()
  internalNote!: string;
}

/**
 * A hand-written filter passed to the factory as `{ filter: WorkOrderFilter }`.
 *
 * Carries the two things a generated fallback never has, and the pair is the
 * point: a `@FilterFor` VIRTUAL field that exists on no entity at all, and an
 * `allowed` list that NARROWS the entity-derived set (`internalNote` is a real
 * column the server will refuse). `auditedBy` uses the operator-restricted entry
 * form; both forms name a field the same way.
 */
@Filterable({
  entity: WorkOrderView,
  autoFields: true,
  allowed: ['id', { field: 'auditedBy', operators: ['$eq'] }],
})
export class WorkOrderFilter {
  @FilterFor('assignedTo', { type: 'string' })
  assignedTo(value: string): void {
    void value;
  }
}

/**
 * A second hand-written filter, named by an OVERRIDING route in its own
 * `@ApplyFilter(...)`. Its allowlist is disjoint from `WorkOrderFilter`'s so a
 * test can see which of the two won.
 */
@Filterable({ entity: WorkOrderView, autoFields: true, allowed: ['id', 'internalNote'] })
export class WorkOrderOverrideFilter {}

/** DTO the table maps rows to — exercises the third factory option. */
export class WorkOrderDto {
  id!: string;
  label!: string;
}
