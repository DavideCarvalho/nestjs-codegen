---
'@dudousxd/nestjs-codegen': minor
---

Follow a factory-produced controller's own heritage chain, so a factory that wraps a factory contributes every level's routes.

`class C extends createTableController(...)` was resolved one level deep: discovery found the class the factory returns and read **its own methods only**. A factory whose returned class itself extends something — another factory call, or an ordinary base class — lost everything the inner level declared. The controller was not skipped, which would at least be visible; it was generated with a subset of its routes and no warning anywhere, while Nest served all of them.

That gap made the natural way to give SOME controllers an extra route unusable. Wrapping the shared factory in a second one and declaring the extra route as an ordinary `@Post('export')` method is the shape that keeps every route statically visible — the conditionality becomes which factory a controller extends — but the wrapper's own base routes disappeared from the client, so the pattern looked broken and the alternative (declaring the handler undecorated and mounting it imperatively, `Post('export')(proto, 'export', descriptor)`) is invisible to a static scan by construction.

Discovery now walks the returned class's chain to any depth, the way Nest walks the prototype chain, resolving each base through the same factory resolution or as a plain class declaration. Nearest declaration wins, so a wrapper overriding an inner route still contributes one route rather than two — matching how a derived controller's own override was already resolved against its base.

Also fixes the types of an inherited route. A route's parameter and return annotations were resolved against the CONTROLLER's file, but they are written in the file that declares the handler — the factory's. A `@Body() body: ExportRequestDto` on a factory-declared method resolved against a file that never imports `ExportRequestDto` and silently degraded to `unknown`, so the route reached the client accepting anything. They now resolve in the declaring file, which is what the filter pass already did. For a route declared on the controller itself the two files are the same and nothing changes.

Both are additive: routes and types that were missing now appear. Regenerate and expect new entries for any controller extending a wrapping factory, and real body/query/response types where an inherited route previously had `unknown`.
