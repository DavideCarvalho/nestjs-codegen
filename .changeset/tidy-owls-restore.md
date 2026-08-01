---
'@dudousxd/nestjs-codegen': patch
---

Fix a regression in 0.23.0: columns whose ORM type disagrees with their TS type stopped being usable.

**If you upgraded to 0.23.0, you were affected** wherever an entity declares a mapped column — `@Property({ columnType: 'date', type: DateType }) x?: Opt<string>`, or a DECIMAL read back as a string. Those fields kept being emitted, but with the wrong `kind`, so every union a client derives from the kind rejected them: `.lt('serviceEndDate', …)` stopped compiling on a column that had been orderable all along.

The cause was the brand unwrapping itself. `classifyFieldType` consults the column decorator ONLY when the TS type resolves to `unknown` — so before 0.23.0 an `Opt<string>` fell through to `columnType: 'date'` and classified `date`, correctly and by accident. Making the TS side resolve meant the decorator was never reached, and the property classified `string`.

Two changes:

- A disagreement between the two now yields `unknown` rather than either side. Neither is usable alone: `string` refuses the ordering and range operators the column supports, `date` types the value as a `Date` it never holds. `unknown` is the one kind that stays permissive in both directions, and is what these columns classified as before. Agreement still keeps the sharper kind, so 0.23.0's improvement is intact for the columns it was written for.
- The decorator reader now understands `columnType` (MikroORM's raw DDL slot) alongside `type`, and a mapped-type class (`type: DateType`) alongside a keyword string. It previously read neither, which is why the conflict was invisible to it.
