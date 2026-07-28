import { type ClassDeclaration, type MethodDeclaration, Node, Project } from 'ts-morph';

export interface InheritedMethods {
  methods: MethodDeclaration[];
  factoryName: string;
  factoryFilePath: string;
  classArgs: Array<{ name: string; filePath: string }>;
  namedClassArgs: Record<string, { name: string; filePath: string }>;
}

/**
 * Resolve a heritage expression to the factory CALL that produced the base.
 *
 * Handles `extends factory(Entity)` directly, and `extends SomeConst` where the
 * const is initialised with such a call. The indirection is not academic: a
 * subclass that overrides a route needs to name the factory's products in its
 * own decorators (e.g. `@ApplyFilter(SomeConst.filter)`), and it cannot
 * reference itself at decoration time — so binding the factory call to a const
 * is the only way to write an override. Requiring a literal call expression here
 * made exactly the pattern the escape hatch depends on undiscoverable.
 */
function resolveHeritageCall(node: Node | undefined) {
  if (!node) return undefined;
  const expr = unwrapExpression(node);
  if (Node.isCallExpression(expr)) return expr;
  if (!Node.isIdentifier(expr)) return undefined;

  const decl = expr
    .getDefinitions()
    .map((d) => d.getDeclarationNode())
    .find(
      (n): n is import('ts-morph').VariableDeclaration =>
        n !== undefined && Node.isVariableDeclaration(n),
    );
  const init = decl?.getInitializer();
  if (!init) return undefined;
  const unwrapped = unwrapExpression(init);
  return Node.isCallExpression(unwrapped) ? unwrapped : undefined;
}

/** Strip `as`/`satisfies`/parenthesised wrappers to the underlying expression. */
function unwrapExpression(node: Node): Node {
  let current = node;
  while (
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isParenthesizedExpression(current) ||
    Node.isTypeAssertion(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

/**
 * A declaration a factory call can resolve to.
 *
 * A `MethodDeclaration` belongs here because `Factory.create(Entity)` — a static
 * method — is an ordinary way to publish a controller factory, and everything
 * downstream only ever reads the body and the name, both of which a method has.
 */
type FactoryDeclaration = import('ts-morph').FunctionDeclaration | MethodDeclaration;

/**
 * Find the class a factory actually RETURNS.
 *
 * Not simply "the first class declared in the body": a controller factory
 * commonly declares helper classes first (e.g. a generated filter), and picking
 * the first one silently yields a class with no routes. Real factories also cast
 * on the way out (`return C as unknown as Type<...>`), so the return expression
 * is unwrapped before resolving.
 */
function resolveReturnedClass(factoryDecl: FactoryDeclaration): ClassDeclaration | undefined {
  const body = factoryDecl.getBody();
  if (!body) return undefined;

  const returns = body
    .getDescendants()
    .filter((n): n is import('ts-morph').ReturnStatement => Node.isReturnStatement(n));

  for (const ret of returns) {
    const expr = ret.getExpression();
    if (!expr) continue;
    const inner = unwrapExpression(expr);

    // `return class { ... }` — the class expression itself.
    if (Node.isClassExpression(inner)) {
      return inner as unknown as ClassDeclaration;
    }

    // `return GeneratedTableController;` — resolve the local declaration.
    if (Node.isIdentifier(inner)) {
      const name = inner.getText();
      const decl = body
        .getDescendants()
        .find((n): n is ClassDeclaration => Node.isClassDeclaration(n) && n.getName() === name);
      if (decl) return decl;
    }
  }

  return undefined;
}

/**
 * The name node a factory call is dispatched through, or undefined when the
 * callee is not a name at all.
 *
 * `factory(...)` names it directly; `<expr>.factory(...)` names it in the
 * property-access' name node — which is the SAME kind of node, resolved the same
 * way, so a namespace import (`tables.createTableController`), a static method
 * (`TableFactory.create`) and a re-export object (`factories.table`) all reduce
 * to one identifier lookup. An `<expr>[...]` element access or a callee that is
 * itself a call (`makeFactory()(Entity)`) has no such node: naming the function
 * would mean evaluating the program, so those stay unresolved (and, at a
 * `@Controller`, loudly so — see {@link warnUnresolvedFactory}).
 */
function factoryCalleeName(
  call: import('ts-morph').CallExpression,
): import('ts-morph').Identifier | undefined {
  const callee = unwrapExpression(call.getExpression());
  if (Node.isIdentifier(callee)) return callee;
  if (Node.isPropertyAccessExpression(callee)) {
    const name = callee.getNameNode();
    return Node.isIdentifier(name) ? name : undefined;
  }
  return undefined;
}

/** Resolve the function or method declaration a factory call expression targets. */
function resolveFactoryDeclaration(
  call: import('ts-morph').CallExpression,
): FactoryDeclaration | undefined {
  const name = factoryCalleeName(call);
  return name ? resolveFactoryFromName(name, new Set()) : undefined;
}

/**
 * Walk a name to the function/method declaration behind it.
 *
 * The first hop is go-to-definition, which already crosses imports, namespace
 * imports and re-export barrels. One further hop is needed for the object-literal
 * form (`export const factories = { table: createTableController }`): there the
 * definition of `table` is the property assignment, and the function is one
 * identifier further on. `seen` guards the self-referential case a shorthand
 * property (`{ createTableController }`) produces, whose name node lists itself
 * among its own definitions.
 */
function resolveFactoryFromName(
  name: import('ts-morph').Identifier,
  seen: Set<Node>,
): FactoryDeclaration | undefined {
  if (seen.has(name)) return undefined;
  seen.add(name);

  const decls = name
    .getDefinitions()
    .map((d) => d.getDeclarationNode())
    .filter((n): n is Node => n !== undefined);

  for (const decl of decls) {
    if (Node.isFunctionDeclaration(decl) || Node.isMethodDeclaration(decl)) return decl;

    if (Node.isPropertyAssignment(decl)) {
      const init = decl.getInitializer();
      const inner = init ? unwrapExpression(init) : undefined;
      if (inner && Node.isIdentifier(inner)) {
        const resolved = resolveFactoryFromName(inner, seen);
        if (resolved) return resolved;
      }
      continue;
    }

    if (Node.isShorthandPropertyAssignment(decl)) {
      const nameNode = decl.getNameNode();
      const resolved = Node.isIdentifier(nameNode)
        ? resolveFactoryFromName(nameNode, seen)
        : undefined;
      if (resolved) return resolved;
    }
  }

  return undefined;
}

/**
 * Report a `@Controller` whose factory heritage discovery could not follow.
 *
 * A controller that inherits its routes contributes them ONLY through this
 * resolution: when it fails the class is not partially generated, it is absent
 * from the client entirely — no route, no type, no error. Both `tsc` and codegen
 * stay green, so the first sign is a missing client call, which is a debugging
 * session rather than a fix. A line on stderr turns the next unsupported callee
 * shape into a five-second read.
 *
 * Deliberately a warning and not a throw: the callee may be perfectly valid code
 * this pass simply cannot name statically, and codegen must not refuse to run
 * over a shape it merely does not model.
 */
function warnUnresolvedFactory(cls: ClassDeclaration, calleeText: string, reason: string): void {
  console.warn(
    `[nestjs-codegen/fast] ${cls.getName() ?? '<anonymous class>'} in ${cls
      .getSourceFile()
      .getFilePath()} extends ${calleeText}(...) but ${reason} — it contributes NO routes to the generated client. Resolvable factory callees: a name (\`factory(...)\`), a namespace or object property (\`ns.factory(...)\`), or a static method (\`Factory.create(...)\`), each resolving to a function or method declaration that returns a class.`,
  );
}

/**
 * Resolve `SomeTable.filter` — a static property on a factory-produced class —
 * to the class declaration the factory assigned to it.
 *
 * A subclass that overrides a route has to re-declare the decorators the base
 * carried, and `@ApplyFilter` needs the very filter class the factory generated
 * internally. It cannot be imported (it is declared inside the function body),
 * so the factory hands it back as a static and the override writes
 * `@ApplyFilter(SomeTable.filter)`. That expression is a property access, not an
 * identifier, so every identifier-only resolver silently skipped it — and a
 * skipped `@ApplyFilter` is not a partial result: the route emits with
 * `body: never` and `filterFields: never`, losing the typed filter builder on
 * exactly the routes that took the escape hatch. Green tsc and green codegen
 * both survive that, so it only shows up as an untypable client call.
 */
export function resolveFactoryStaticClass(node: Node): ClassDeclaration | undefined {
  if (!Node.isPropertyAccessExpression(node)) return undefined;

  const call = resolveHeritageCall(node.getExpression());
  if (!call) return undefined;

  const factoryDecl = resolveFactoryDeclaration(call);
  if (!factoryDecl) return undefined;

  const returnedClass = resolveReturnedClass(factoryDecl);
  if (!returnedClass) return undefined;

  const staticProp = returnedClass
    .getStaticProperties()
    .find((p) => p.getName() === node.getName());
  if (!staticProp || !Node.isPropertyDeclaration(staticProp)) return undefined;

  const init = staticProp.getInitializer();
  if (!init) return undefined;
  const inner = unwrapExpression(init);

  if (Node.isClassExpression(inner)) return inner as unknown as ClassDeclaration;
  if (!Node.isIdentifier(inner)) return undefined;

  // The assigned class is declared in the factory body, invisible to any
  // module-level lookup — resolve it lexically from the identifier itself.
  return inner
    .getDefinitions()
    .map((d) => d.getDeclarationNode())
    .find((n): n is ClassDeclaration => n !== undefined && Node.isClassDeclaration(n));
}

/**
 * Resolve a `class X extends someFactory(Entity) {}` heritage clause to the
 * decorated methods of the class expression the factory returns.
 *
 * NestJS routes inherited methods at runtime (its metadata scan walks the
 * prototype chain); this teaches the static discovery pass to follow the same
 * link. Returns undefined when the heritage clause is absent, or is not a call
 * expression whose callee resolves to a function returning a class.
 *
 * A failure to resolve is reported (see {@link warnUnresolvedFactory}) — but
 * only for a `@Controller`-decorated class, and only once the heritage clause is
 * known to be a factory-shaped CALL. `extends SomeBaseClass` and every call-
 * extending class that is not a controller stay silent: they are ordinary code
 * this pass has no expectation of, and warning on them would bury the one line
 * that matters.
 */
export function resolveInheritedMethods(cls: ClassDeclaration): InheritedMethods | undefined {
  const expr = resolveHeritageCall(cls.getExtends()?.getExpression());
  if (!expr) return undefined;

  const isController = cls.getDecorator('Controller') !== undefined;
  const calleeText = expr.getExpression().getText();

  const factoryDecl = resolveFactoryDeclaration(expr);
  if (!factoryDecl) {
    if (isController) {
      warnUnresolvedFactory(
        cls,
        calleeText,
        factoryCalleeName(expr)
          ? 'its callee does not resolve to a function or method declaration'
          : 'its callee is not a name that can be resolved statically',
      );
    }
    return undefined;
  }

  const returnedClass = resolveReturnedClass(factoryDecl);
  if (!returnedClass) {
    if (isController) {
      warnUnresolvedFactory(cls, calleeText, 'that factory does not return a class declaration');
    }
    return undefined;
  }

  const classArgs: Array<{ name: string; filePath: string }> = [];
  const namedClassArgs: Record<string, { name: string; filePath: string }> = {};
  for (const arg of expr.getArguments()) {
    const positional = resolveClassReference(arg);
    if (positional) {
      classArgs.push(positional);
      continue;
    }
    // `createTableController({ entity: Widget, filter: WidgetFilter })` — the
    // single-options-object call form. The object literal is not an identifier,
    // so the positional pass above sees nothing at all; its class-valued
    // properties are the ONLY record of what the factory was parameterised with.
    if (!Node.isObjectLiteralExpression(arg)) continue;
    for (const prop of arg.getProperties()) {
      const named = resolvePropertyClassReference(prop);
      if (!named) continue;
      // First occurrence wins, mirroring the positional pass — a duplicate key
      // is a type error at the call site anyway.
      namedClassArgs[named.key] ??= named.ref;
    }
  }

  return {
    methods: returnedClass.getMethods(),
    // The DECLARATION's name, not the call-site text: consumers look the factory
    // back up by name inside `factoryFilePath`, which a qualified
    // `tables.createTableController` would never match. For a bare identifier
    // the two coincide (bar an import alias, where the declaration name is the
    // one that resolves anyway).
    factoryName: factoryDecl.getName() ?? calleeText,
    factoryFilePath: factoryDecl.getSourceFile().getFilePath(),
    classArgs,
    namedClassArgs,
  };
}

/** Resolve an expression to the class declaration it names, if it names one. */
function resolveClassReference(node: Node): { name: string; filePath: string } | undefined {
  const expr = unwrapExpression(node);
  if (!Node.isIdentifier(expr)) return undefined;
  const decl = expr
    .getDefinitions()
    .map((d) => d.getDeclarationNode())
    .find((n): n is ClassDeclaration => n !== undefined && Node.isClassDeclaration(n));
  if (!decl) return undefined;
  return {
    name: decl.getName() ?? expr.getText(),
    filePath: decl.getSourceFile().getFilePath(),
  };
}

/**
 * Resolve one property of an options-object argument to the class it names,
 * keyed by the property name (`entity: Widget` → `entity`).
 *
 * Handles the shorthand form (`{ entity }`) too: its name node is also the value
 * expression, so the same identifier resolution applies. The class is normally
 * imported from another module — resolution goes through the identifier's
 * definitions rather than any module-level lookup, so a re-export or an aliased
 * import resolves the same way the positional pass resolves it.
 */
function resolvePropertyClassReference(
  prop: Node,
): { key: string; ref: { name: string; filePath: string } } | undefined {
  if (Node.isShorthandPropertyAssignment(prop)) {
    const ref = resolveClassReference(prop.getNameNode());
    return ref ? { key: prop.getName(), ref } : undefined;
  }
  if (!Node.isPropertyAssignment(prop)) return undefined;
  const init = prop.getInitializer();
  if (!init) return undefined;
  const ref = resolveClassReference(init);
  if (!ref) return undefined;
  // `getName()` hands back the raw name text, quotes included for a
  // string-literal key (`{ 'entity': X }`) — unquote so consumers can look the
  // key up by the property name they know.
  const nameNode = prop.getNameNode();
  const key = Node.isStringLiteral(nameNode) ? nameNode.getLiteralValue() : prop.getName();
  return { key, ref };
}

/**
 * A second ts-morph Project used ONLY to instantiate mixin response types.
 *
 * The discovery Project sets `skipLoadingLibFiles: true` for cold-start speed,
 * and without the lib types the checker silently gives up on generic inference:
 * `createTableController(Widget, { dto })` resolves to `Paginated<D>` (type
 * parameter unsubstituted) instead of `Paginated<WidgetDto>`. Measured: that one
 * flag is the cause — `skipFileDependencyResolution` makes no difference.
 *
 * Rather than pay lib loading for every discovery run, this Project is built
 * lazily on the first mixin controller and reused. Cleared alongside the other
 * per-Project caches so watch mode never serves a stale type.
 */
let mixinTypeProject: Project | undefined;

function getMixinTypeProject(): Project {
  mixinTypeProject ??= new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { strict: true },
  });
  return mixinTypeProject;
}

/** Drop the mixin type Project so the next resolution re-reads from disk. */
export function clearMixinTypeProject(): void {
  mixinTypeProject = undefined;
}

/**
 * Resolve an inherited method's return type as instantiated for `cls`.
 *
 * Every other response type in discovery is read syntactically (via
 * `getReturnTypeNode()`), which is correct for a method declared on the
 * controller itself. A factory-produced base annotates its return with the
 * factory's own type parameters (`Promise<Paginated<D>>`), and those only bind
 * at the derived class — so this one path asks the type checker for the property
 * type AT the derived class, which performs the substitution. Promise is
 * unwrapped to match what the syntactic resolvers hand back.
 */
export function resolveInstantiatedReturnType(
  cls: ClassDeclaration,
  methodName: string,
): string | undefined {
  const filePath = cls.getSourceFile().getFilePath();
  const className = cls.getName();
  if (!className) return undefined;

  const project = getMixinTypeProject();
  // Dependency resolution is ON here, so adding the controller pulls in the
  // factory module (and the entity/DTO it references) automatically.
  const sourceFile =
    project.getSourceFile(filePath) ?? project.addSourceFileAtPathIfExists(filePath);
  const typedCls = sourceFile?.getClass(className);
  if (!typedCls) return undefined;

  const prop = typedCls.getType().getProperty(methodName);
  if (!prop) return undefined;

  const returnType = prop.getTypeAtLocation(typedCls).getCallSignatures()[0]?.getReturnType();
  if (!returnType) return undefined;

  const unwrapped =
    returnType.getSymbol()?.getName() === 'Promise'
      ? (returnType.getTypeArguments()[0] ?? returnType)
      : returnType;

  return unwrapped.getText(typedCls);
}
