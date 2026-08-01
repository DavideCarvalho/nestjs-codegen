import { Controller, Get } from '@nestjs/common';

// ── Simulated decorators (same shape as the real ones) ──────────────────────
function Property(_opts?: unknown): PropertyDecorator {
  return () => {};
}
function Filterable(_opts?: unknown): ClassDecorator {
  return () => {};
}
function ApplyFilter(_filterClass: new (...args: unknown[]) => unknown): ParameterDecorator {
  return () => {};
}

// ── MikroORM's brand types, structurally as the ORM declares them ───────────
//
// `Opt` and `Hidden` add a compile-time marker and nothing else: the runtime
// value of an `Opt<string>` column is a string. `Ref` does not — its value is a
// reference object, which is why it must NOT be unwrapped.
type Opt<T> = T & { __optional?: 1 };
type Hidden<T> = T & { __hidden?: 1 };
type Ref<T> = { unwrap(): T; __ref?: 1 };

class Owner {
  id!: string;
}

// MikroORM's mapped-type classes. `DateType` maps a DATE column to a
// 'YYYY-MM-DD' string, which is why the entity below types those columns
// `Opt<string>` while the column itself is a date.
class DateType {}

@Filterable()
export class BrandedFilter {
  // Bare primitives — the baseline, classified before this fixture existed.
  @Property()
  plainName!: string;

  @Property()
  plainCount!: number;

  // The shape nearly every nullable MikroORM column is written in.
  @Property({ nullable: true })
  brandedName?: Opt<string>;

  @Property({ nullable: true })
  brandedCount?: Opt<number>;

  @Property({ nullable: true })
  brandedFlag?: Opt<boolean>;

  @Property({ nullable: true })
  brandedDate?: Opt<Date>;

  // The other transparent brand.
  @Property({ nullable: true })
  hiddenSecret?: Hidden<string>;

  // Nested brands still resolve to the innermost real type.
  @Property({ nullable: true })
  doubleBranded?: Opt<Hidden<number>>;

  // ── Columns whose ORM type disagrees with the TS type ────────────────────
  //
  // A DATE column read back as a 'YYYY-MM-DD' string: the ORM says date, the TS
  // type says string. Both are true, and the disagreement is the normal shape
  // of a MikroORM date column — not an authoring mistake.
  @Property({ fieldName: 'Service End Dt', columnType: 'date', type: DateType, nullable: true })
  serviceEndDate?: Opt<string> | null;

  // The same conflict declared with only `type: DateType` (no `columnType`).
  @Property({ type: DateType, nullable: true })
  nextMaintenanceDate?: Opt<string>;

  // The other classic MikroORM shape: a DECIMAL column mapped to a string so no
  // precision is lost through the JS number.
  @Property({ columnType: 'decimal', nullable: true })
  totalCost?: Opt<string>;

  // The agreeing case, which must keep the sharper classification: TS says
  // number, the column says int.
  @Property({ columnType: 'int', nullable: true })
  interval?: Opt<number>;

  // Agreement through a string column, too.
  @Property({ columnType: 'varchar', length: 255, nullable: true })
  assetName?: Opt<string>;

  // A relation wrapper. NOT transparent: the value is a reference, not an
  // `Owner`, so unwrapping would classify a relation as its target's shape.
  @Property()
  owner!: Ref<Owner>;
}

@Controller('branded')
export class BrandedController {
  @Get()
  list(@ApplyFilter(BrandedFilter) _qb: unknown) {
    return [];
  }
}
