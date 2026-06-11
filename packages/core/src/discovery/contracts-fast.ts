import { join, resolve } from 'node:path';
import fg from 'fast-glob';
/**
 * Static AST-based contract discovery using ts-morph.
 * Cold start ~100-500 ms.
 */
import {
  type ClassDeclaration,
  type MethodDeclaration,
  Node,
  Project,
  type SourceFile,
} from 'ts-morph';
import { extractDtoContract } from './dto-type-resolver.js';
import { loadTsconfigPaths, setDiscoveryContext } from './type-ref-resolution.js';
import type { ContractSource, RouteDescriptor, TypeRef } from './types.js';
import { type ParsedContractDef, parseDefineContractCall } from './zod-ast-to-ts.js';

// Re-export so existing test import paths (`../discovery/contracts-fast.js`)
// keep resolving these symbols after the decomposition into sibling modules.
export { extractDtoContract } from './dto-type-resolver.js';
export { zodAstToTs } from './zod-ast-to-ts.js';

export interface FastDiscoveryOptions {
  /** Absolute path to the project root. */
  cwd: string;
  /** Controllers glob, e.g. 'src/**\/*.controller.ts' */
  glob: string;
  /** Optional tsconfig.json path; default 'tsconfig.json' in cwd */
  tsconfig?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function discoverContractsFast(
  opts: FastDiscoveryOptions,
): Promise<RouteDescriptor[]> {
  const { cwd, glob, tsconfig } = opts;

  const tsconfigPath = tsconfig ? resolve(tsconfig) : join(cwd, 'tsconfig.json');

  // Try to use tsconfig if it exists; fall back to bare compiler options
  let project: Project;
  try {
    project = new Project({
      tsConfigFilePath: tsconfigPath,
      skipAddingFilesFromTsConfig: true,
      skipLoadingLibFiles: true,
      skipFileDependencyResolution: true,
    });
  } catch {
    // tsconfig not found — create a minimal project without it
    project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipLoadingLibFiles: true,
      skipFileDependencyResolution: true,
      compilerOptions: {
        allowJs: true,
        resolveJsonModule: false,
        strict: false,
      },
    });
  }

  // Resolve controller file paths
  const files = await fg(glob, { cwd, absolute: true, onlyFiles: true });

  for (const f of files) {
    project.addSourceFileAtPath(f);
  }

  const routes: RouteDescriptor[] = [];

  // Bind the discovery context to this invocation's Project. Each call owns its
  // own Project, so concurrent callers never share or corrupt context.
  setDiscoveryContext(project, {
    projectRoot: cwd,
    tsconfigPaths: loadTsconfigPaths(tsconfigPath),
  });

  for (const sourceFile of project.getSourceFiles()) {
    routes.push(...extractFromSourceFile(sourceFile, project));
  }

  return routes;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the string value from a decorator argument that is a string literal. */
function decoratorStringArg(decoratorExpr: Node | undefined): string | undefined {
  if (!decoratorExpr) return undefined;
  if (Node.isStringLiteral(decoratorExpr)) return decoratorExpr.getLiteralValue();
  if (Node.isArrayLiteralExpression(decoratorExpr)) {
    const first = decoratorExpr.getElements()[0];
    if (first && Node.isStringLiteral(first)) return first.getLiteralValue();
  }
  return undefined;
}

/**
 * Derive the route name from a controller class name and method name.
 * Strips the `Controller` suffix from the class name and lowercases the first letter.
 * e.g. `UsersController.list` → `users.list`
 */
export function deriveRouteName(className: string, methodName: string): string {
  const noSuffix = className.replace(/Controller$/, '');
  if (!noSuffix) {
    throw new Error(
      `Controller class name "${className}" derives empty route segment after stripping "Controller". Add an @As(...) override.`,
    );
  }
  const segment = noSuffix.charAt(0).toLowerCase() + noSuffix.slice(1);
  return `${segment}.${methodName}`;
}

/**
 * Derive just the class segment (no method) from a controller class name.
 * Strips the `Controller` suffix and lowercases the first letter.
 */
export function deriveClassSegment(className: string): string {
  const noSuffix = className.replace(/Controller$/, '');
  if (!noSuffix) {
    throw new Error(
      `Controller class name "${className}" derives empty route segment after stripping "Controller". Add an @As(...) override at the class level.`,
    );
  }
  return noSuffix.charAt(0).toLowerCase() + noSuffix.slice(1);
}

/**
 * Compose the final route name from class-level and method-level @As decorators.
 * Rule:
 *   classPortion  = class @As value  ?? deriveClassSegment(className)
 *   methodPortion = method @As value ?? methodName
 *   result        = `${classPortion}.${methodPortion}`
 */
export function resolveRouteName(
  className: string,
  methodName: string,
  classAs: string | undefined,
  methodAs: string | undefined,
): string {
  const classPortion = classAs ?? deriveClassSegment(className);
  const methodPortion = methodAs ?? methodName;
  return `${classPortion}.${methodPortion}`;
}

/** Join two URL path segments, normalising duplicate slashes. */
export function joinPaths(prefix: string, suffix: string): string {
  if (!prefix && !suffix) return '/';
  if (!prefix) return suffix.startsWith('/') ? suffix : `/${suffix}`;
  if (!suffix) return prefix.startsWith('/') ? prefix : `/${prefix}`;

  const p = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const s = suffix.startsWith('/') ? suffix : `/${suffix}`;
  const combined = p + s;
  return combined === '' ? '/' : combined;
}

/** Extract path params from a URL pattern string, e.g. `/users/:id` → [{name:'id',source:'path'}] */
function extractParams(
  path: string,
): Array<{ name: string; source: 'path' | 'query' | 'body' | 'header' }> {
  const matches = path.matchAll(/:(\w+)/g);
  return Array.from(matches).map((m) => ({ name: m[1] as string, source: 'path' as const }));
}

// ---------------------------------------------------------------------------
// HTTP method decorator names recognised by the fast path
// ---------------------------------------------------------------------------

const HTTP_METHOD_DECORATORS: Record<string, string> = {
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Patch: 'PATCH',
  Delete: 'DELETE',
  Options: 'OPTIONS',
  Head: 'HEAD',
  All: 'ALL',
};

// ---------------------------------------------------------------------------
// Per-file extraction
// ---------------------------------------------------------------------------

/** Resolved HTTP verb + handler sub-path read from a method's NestJS verb decorator. */
interface ResolvedVerb {
  httpMethod: string;
  handlerPath: string;
}

/**
 * Read the HTTP verb + sub-path from a method's NestJS verb decorator
 * (`@Get`/`@Post`/…). Returns null when the method carries no verb decorator.
 */
function resolveVerb(method: MethodDeclaration): ResolvedVerb | null {
  for (const [decoratorName, verb] of Object.entries(HTTP_METHOD_DECORATORS)) {
    const httpDecorator = method.getDecorator(decoratorName);
    if (httpDecorator) {
      const httpArgs = httpDecorator.getArguments();
      const pathArg = httpArgs[0];
      return { httpMethod: verb, handlerPath: decoratorStringArg(pathArg) ?? '' };
    }
  }
  return null;
}

/**
 * Read an `@As(...)` decorator value off a node (class or method).
 * Throws when the decorator is present but its argument is empty — preserving
 * the @ApplyContract arm's strict policy, unified across both route arms.
 * Returns undefined when no `@As` decorator is present.
 */
function readAsDecorator(
  node: ClassDeclaration | MethodDeclaration,
  label: string,
): string | undefined {
  const asDecorator = node.getDecorator('As');
  if (!asDecorator) return undefined;
  const asName = decoratorStringArg(asDecorator.getArguments()[0]);
  if (!asName) {
    throw new Error(`@As decorator on ${label} must have a non-empty string argument.`);
  }
  return asName;
}

/**
 * Build a {@link RouteDescriptor} and register its name for collision detection.
 * Throws on a duplicate route name across the file's contracted/plain routes.
 */
function buildRoute(args: {
  className: string;
  methodName: string;
  resolvedMethod: string;
  combinedPath: string;
  classAs: string | undefined;
  methodAs: string | undefined;
  sourceFile: SourceFile;
  seenNames: Map<string, string>;
  contractSource: ContractSource;
}): RouteDescriptor {
  const {
    className,
    methodName,
    resolvedMethod,
    combinedPath,
    classAs,
    methodAs,
    sourceFile,
    seenNames,
    contractSource,
  } = args;

  const routeName = resolveRouteName(className, methodName, classAs, methodAs);

  // Collision detection across routes in the same file.
  const qualifiedRef = `${className}.${methodName}`;
  const existing = seenNames.get(routeName);
  if (existing !== undefined) {
    throw new Error(
      `Route name collision: "${routeName}" is used by both "${existing}" and "${qualifiedRef}". Use @As(...) to give one of them a unique name.`,
    );
  }
  seenNames.set(routeName, qualifiedRef);

  return {
    method: resolvedMethod,
    path: combinedPath,
    name: routeName,
    params: extractParams(combinedPath),
    controllerRef: { className, methodName, filePath: sourceFile.getFilePath() },
    contract: { contractSource },
  };
}

/**
 * Build a route from an `@ApplyContract` method. Returns null when the contract
 * cannot be resolved or the method lacks an HTTP verb decorator.
 */
function extractContractRoute(args: {
  cls: ClassDeclaration;
  method: MethodDeclaration;
  applyContractDecorator: import('ts-morph').Decorator;
  verb: ResolvedVerb | null;
  prefix: string;
  className: string;
  sourceFile: SourceFile;
  seenNames: Map<string, string>;
}): RouteDescriptor | null {
  const { cls, method, applyContractDecorator, verb, prefix, className, sourceFile, seenNames } =
    args;

  const firstDecoratorArg = applyContractDecorator.getArguments()[0];
  if (!firstDecoratorArg) return null;

  // Resolve contract definition from inline call or identifier.
  let contractDef: ParsedContractDef | null = null;
  // When the contract is a named const we can import, re-export its members
  // (`<const>.body` / `<const>.query`) for perfect parity.
  let bodyZodRef: TypeRef | null = null;
  let queryZodRef: TypeRef | null = null;

  if (Node.isCallExpression(firstDecoratorArg)) {
    contractDef = parseDefineContractCall(firstDecoratorArg);
  } else if (Node.isIdentifier(firstDecoratorArg)) {
    const identName = firstDecoratorArg.getText();
    const varDecl = sourceFile.getVariableDeclaration(identName);
    if (!varDecl) {
      console.warn(
        `[nestjs-codegen/fast] Cannot resolve '${identName}' in ${sourceFile.getFilePath()} (cross-file imports are out-of-scope for v1) — skipping`,
      );
      return null;
    }

    const initializer = varDecl.getInitializer();
    if (!initializer) return null;

    contractDef = parseDefineContractCall(initializer);
    // Re-export the named contract's schema members (Path A). Only when the
    // const is exported so forms.ts can import it.
    if (contractDef && varDecl.isExported()) {
      const filePath = sourceFile.getFilePath();
      if (contractDef.body !== null) {
        bodyZodRef = { name: `${identName}.body`, filePath };
      }
      if (contractDef.query !== null) {
        queryZodRef = { name: `${identName}.query`, filePath };
      }
    }
  } else {
    console.warn(
      `[nestjs-codegen/fast] @ApplyContract arg is not an identifier or call expression in ${sourceFile.getFilePath()} — skipping`,
    );
    return null;
  }

  if (!contractDef) return null;

  // Method + path always come from NestJS decorators — skip if absent.
  if (!verb) return null;
  const resolvedPath = joinPaths(prefix, verb.handlerPath);
  const methodName = method.getName();

  const classAs = readAsDecorator(cls, `class ${className}`);
  const methodAs = readAsDecorator(method, `${className}.${methodName}`);

  return buildRoute({
    className,
    methodName,
    resolvedMethod: verb.httpMethod,
    combinedPath: resolvedPath,
    classAs,
    methodAs,
    sourceFile,
    seenNames,
    contractSource: {
      query: contractDef.query,
      body: contractDef.body,
      response: contractDef.response,
      // Path A: capture both the importable ref and the raw text. The emitter
      // prefers inlining the text (client-safe — re-exporting from a controller
      // would drag server-only deps into the client bundle).
      bodyZodRef,
      bodyZodText: contractDef.bodyZodText,
      queryZodRef,
      queryZodText: contractDef.queryZodText,
    },
  });
}

/**
 * Build a route from a plain HTTP-verb method (no `@ApplyContract`), extracting
 * any DTO-based contract info. Returns null when the method lacks a verb.
 */
function extractDtoRoute(args: {
  cls: ClassDeclaration;
  method: MethodDeclaration;
  verb: ResolvedVerb | null;
  prefix: string;
  className: string;
  sourceFile: SourceFile;
  project: Project;
  seenNames: Map<string, string>;
}): RouteDescriptor | null {
  const { cls, method, verb, prefix, className, sourceFile, project, seenNames } = args;

  if (!verb) return null;

  const combined = joinPaths(prefix, verb.handlerPath);
  const methodName = method.getName();

  const classAs = readAsDecorator(cls, `class ${className}`);
  const methodAs = readAsDecorator(method, `${className}.${methodName}`);

  const dtoContract = extractDtoContract(method, sourceFile, project);

  return buildRoute({
    className,
    methodName,
    resolvedMethod: verb.httpMethod,
    combinedPath: combined,
    classAs,
    methodAs,
    sourceFile,
    seenNames,
    contractSource: {
      query: dtoContract?.query ?? null,
      body: dtoContract?.body ?? null,
      response: dtoContract?.response ?? 'unknown',
      queryRef: dtoContract?.queryRef ?? null,
      bodyRef: dtoContract?.bodyRef ?? null,
      responseRef: dtoContract?.responseRef ?? null,
      filterFields: dtoContract?.filterFields ?? null,
      filterFieldTypes: dtoContract?.filterFieldTypes ?? null,
      filterSource: dtoContract?.filterSource ?? null,
      formWarnings: dtoContract?.formWarnings ?? [],
      bodySchema: dtoContract?.bodySchema ?? null,
      querySchema: dtoContract?.querySchema ?? null,
    },
  });
}

function extractFromSourceFile(sourceFile: SourceFile, project: Project): RouteDescriptor[] {
  const routes: RouteDescriptor[] = [];
  // Track derived/assigned names to detect collisions: name → fully-qualified method ref
  const seenNames = new Map<string, string>();

  for (const cls of sourceFile.getClasses()) {
    // Find @Controller(...) decorator
    const controllerDecorator = cls.getDecorator('Controller');
    if (!controllerDecorator) continue;

    // Determine controller path prefix
    const firstArg = controllerDecorator.getArguments()[0];
    const prefix = decoratorStringArg(firstArg) ?? '';

    const className = cls.getName() ?? 'Unknown';

    for (const method of cls.getMethods()) {
      const verb = resolveVerb(method);
      const applyContractDecorator = method.getDecorator('ApplyContract');

      const route = applyContractDecorator
        ? extractContractRoute({
            cls,
            method,
            applyContractDecorator,
            verb,
            prefix,
            className,
            sourceFile,
            seenNames,
          })
        : extractDtoRoute({
            cls,
            method,
            verb,
            prefix,
            className,
            sourceFile,
            project,
            seenNames,
          });

      if (route) routes.push(route);
    }
  }

  return routes;
}
