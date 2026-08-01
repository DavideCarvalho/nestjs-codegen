---
'@dudousxd/nestjs-codegen': minor
---

A mapped column's two declared types can disagree, so both are now emitted.

**If you upgraded to 0.23.0, you were affected** wherever an entity declares a mapped column — `@Property({ columnType: 'date', type: DateType }) x?: Opt<string>`, or a DECIMAL read back as a string. Those fields kept being emitted, but with the wrong kind, so every union a client derives from it rejected them: `.lt('serviceEndDate', …)` stopped compiling on a column that had been orderable all along.

The cause was the brand unwrapping itself. `classifyFieldType` consults the column decorator ONLY when the TS type resolves to `unknown` — so before 0.23.0 an `Opt<string>` fell through to `columnType: 'date'` and classified `date`, correctly and by accident. Making the TS side resolve meant the decorator was never reached.

The fix is not to pick a winner, because both are true and each is needed for a different question. `kind` now carries what the COLUMN is — the semantics an operator set derives from — and a new optional `valueKind` carries what the VALUE is, when they differ. A DATE column read back as `'YYYY-MM-DD'` emits `kind: 'date'` and `valueKind: 'string'`.

Collapsing them loses one or the other. Answer `string` and the field stops accepting the ordering and range operators the column supports. Answer `date` and the emitted type promises a `Date` the value never holds — which a type-preserving wire format like superjson then contradicts at runtime, since it faithfully transports the string that is actually there. That second failure predates 0.23.0 and is fixed here too: these columns used to emit as `Date` while carrying a string.

`valueKind` is absent when the two agree, which is the overwhelming majority of columns, so nothing changes for them.

Also teaches the decorator reader `columnType` (MikroORM's raw DDL slot) alongside `type`, and a mapped-type class (`type: DateType`) alongside a keyword string. It read neither, which is why the conflict was invisible from that side.
