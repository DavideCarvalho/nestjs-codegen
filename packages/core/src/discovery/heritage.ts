import { type ClassDeclaration, type MethodDeclaration, Node, Project } from 'ts-morph';

export interface InheritedMethods {
  methods: MethodDeclaration[];
  factoryName: string;
  factoryFilePath: string;
  classArgs: Array<{ name: string; filePath: string }>;
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
export function resolveInheritedMethods(
  cls: ClassDeclaration,
): InheritedMethods | undefined {
  const expr = cls.getExtends()?.getExpression();
  if (!expr || !Node.isCallExpression(expr)) return undefined;

  const callee = expr.getExpression();
  if (!Node.isIdentifier(callee)) return undefined;

  const factoryDecl = callee
    .getDefinitions()
    .map((d) => d.getDeclarationNode())
    .find((n): n is import('ts-morph').FunctionDeclaration => Node.isFunctionDeclaration(n));
  if (!factoryDecl) return undefined;

  // The factory body declares the controller as a local class, then returns it.
  const returnedClass = factoryDecl
    .getDescendants()
    .find((n): n is ClassDeclaration => Node.isClassDeclaration(n));
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
