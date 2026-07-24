import { type ClassDeclaration, type MethodDeclaration, Node } from 'ts-morph';

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
