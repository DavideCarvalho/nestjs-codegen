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
