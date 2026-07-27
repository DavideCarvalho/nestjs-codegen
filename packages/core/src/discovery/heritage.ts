import { type ClassDeclaration, type MethodDeclaration, Node, Project } from 'ts-morph';

export interface InheritedMethods {
  methods: MethodDeclaration[];
  factoryName: string;
  factoryFilePath: string;
  classArgs: Array<{ name: string; filePath: string }>;
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
 * Find the class a factory actually RETURNS.
 *
 * Not simply "the first class declared in the body": a controller factory
 * commonly declares helper classes first (e.g. a generated filter), and picking
 * the first one silently yields a class with no routes. Real factories also cast
 * on the way out (`return C as unknown as Type<...>`), so the return expression
 * is unwrapped before resolving.
 */
function resolveReturnedClass(
  factoryDecl: import('ts-morph').FunctionDeclaration,
): ClassDeclaration | undefined {
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

/** Resolve the function declaration a factory call expression targets. */
function resolveFactoryDeclaration(
  call: import('ts-morph').CallExpression,
): import('ts-morph').FunctionDeclaration | undefined {
  const callee = call.getExpression();
  if (!Node.isIdentifier(callee)) return undefined;
  return callee
    .getDefinitions()
    .map((d) => d.getDeclarationNode())
    .find((n): n is import('ts-morph').FunctionDeclaration => Node.isFunctionDeclaration(n));
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
 */
export function resolveInheritedMethods(cls: ClassDeclaration): InheritedMethods | undefined {
  const expr = resolveHeritageCall(cls.getExtends()?.getExpression());
  if (!expr) return undefined;

  const callee = expr.getExpression();
  if (!Node.isIdentifier(callee)) return undefined;

  const factoryDecl = resolveFactoryDeclaration(expr);
  if (!factoryDecl) return undefined;

  const returnedClass = resolveReturnedClass(factoryDecl);
  if (!returnedClass) return undefined;

  const classArgs: Array<{ name: string; filePath: string }> = [];
  for (const arg of expr.getArguments()) {
    if (!Node.isIdentifier(arg)) continue;
    const decl = arg
      .getDefinitions()
      .map((d) => d.getDeclarationNode())
      .find((n): n is ClassDeclaration => Node.isClassDeclaration(n));
    if (decl) {
      classArgs.push({
        name: decl.getName() ?? arg.getText(),
        filePath: decl.getSourceFile().getFilePath(),
      });
    }
  }

  return {
    methods: returnedClass.getMethods(),
    factoryName: callee.getText(),
    factoryFilePath: factoryDecl.getSourceFile().getFilePath(),
    classArgs,
  };
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
