import { ts } from 'ts-morph';

/**
 * The imports that failed to resolve in a long-lived program, re-checked against
 * the disk on each watch pass.
 *
 * A program built again over unchanged files keeps their failed resolutions, so a
 * module that appears after the import naming it would stay missing for as long as
 * the importing file is not edited. The failures are collected once per program
 * (TypeScript re-resolves them whenever it builds a new one) and each check costs
 * one module resolution per failed import.
 */
export class UnresolvedImports {
  private read:
    | { program: ts.Program; imports: Array<{ specifier: string; from: string }> }
    | undefined;

  /**
   * The files with an import that failed to resolve in `program` and now resolves
   * to a TypeScript file the program does not hold.
   */
  nowResolving(program: ts.Program): string[] {
    if (this.read?.program !== program) {
      this.read = { program, imports: failedImports(program) };
    }
    const options = program.getCompilerOptions();
    const files = new Set<string>();
    for (const { specifier, from } of this.read.imports) {
      const file = ts.resolveModuleName(specifier, from, options, ts.sys).resolvedModule
        ?.resolvedFileName;
      if (file !== undefined && /\.(m|c)?tsx?$/.test(file) && !program.getSourceFile(file)) {
        files.add(from);
      }
    }
    return [...files];
  }
}

function failedImports(program: ts.Program): Array<{ specifier: string; from: string }> {
  const checker = program.getTypeChecker();
  const imports: Array<{ specifier: string; from: string }> = [];
  for (const file of program.getSourceFiles()) {
    if (program.isSourceFileDefaultLibrary(file) || file.isDeclarationFile) continue;
    if (program.isSourceFileFromExternalLibrary(file)) continue;
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier)) continue;
      if (!checker.getSymbolAtLocation(specifier)) {
        imports.push({ specifier: specifier.text, from: file.fileName });
      }
    }
  }
  return imports;
}
