---
'@dudousxd/nestjs-codegen': minor
---

Tell an overridden route from an inherited one by the class it is declared on, not by its file

`extractApplyFilterInfo` decided whether a route was the controller's OWN by
comparing the method's file to the factory's (`declFile !== mixin.factoryFilePath`).
That is a proxy for the real question, and it breaks on the one shape where the
two come apart: a controller factory declared in the SAME file as a controller
that calls it. There, a genuine override reads as inherited, its
`@ApplyFilter(SomeFilter)` is mistaken for the factory talking about itself, and
the factory's `filter` option silently outranks the filter the override names —
typing the route against a filter the runtime does not use.

`extractDtoContract` now takes the `@Controller` class the route was discovered
on and passes it down, so the check is `method.getParent() === controllerClass`:
the ground truth the discovery pass already computed when it merged own and
inherited methods. The parameter is optional — omitting it degrades to the
previous file comparison, so an external caller of the exported
`extractDtoContract` keeps working unchanged.

This also settles a disagreement between packages. `@dudousxd/nestjs-filter-codegen`
asks the same question via `controllerClass.getMethod(name)` and was already
right about the colocated case; the two have to agree on what an override IS, not
merely on how to rank one, or the same route ends up described twice, differently.
