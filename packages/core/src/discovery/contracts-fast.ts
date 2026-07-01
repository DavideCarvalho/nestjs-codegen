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
import { clearEnumCache } from './enum-resolution.js';
import {
  clearTypeResolutionCaches,
  loadTsconfigPaths,
  resolveImportedVariable,
  setDiscoveryContext,
} from './type-ref-resolution.js';
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

  const tsconfigPath = resolveTsconfigPath(cwd, tsconfig);
  const project = createDiscoveryProject(tsconfigPath);

  // Resolve controller file paths and add them to the project.
  const files = await fg(glob, { cwd, absolute: true, onlyFiles: true });
  for (const f of files) {
    project.addSourceFileAtPath(f);
  }

  bindDiscoveryContext(project, cwd, tsconfigPath);
  return extractAllRoutes(project);
}

// ---------------------------------------------------------------------------
// Persistent-Project building blocks (used by the watcher to reuse ONE Project
// across file changes — see watch/watcher.ts). The cold one-shot path above
// keeps building a fresh Project per call, so its per-Project resolution caches
// auto-invalidate; the watcher must evict them explicitly on each change.
// ---------------------------------------------------------------------------

/** Resolve the tsconfig path the same way the cold path does. */
export function resolveTsconfigPath(cwd: string, tsconfig?: string): string {
  return tsconfig ? resolve(tsconfig) : join(cwd, 'tsconfig.json');
}

/**
 * Construct a ts-morph `Project` configured exactly as the cold discovery path:
 * use the tsconfig when present, else fall back to bare compiler options.
 */
export function createDiscoveryProject(tsconfigPath: string): Project {
  try {
    return new Project({
      tsConfigFilePath: tsconfigPath,
      skipAddingFilesFromTsConfig: true,
      skipLoadingLibFiles: true,
      skipFileDependencyResolution: true,
    });
  } catch {
    // tsconfig not found — create a minimal project without it
    return new Project({
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
}

/** Bind the per-Project discovery context (project root + tsconfig path aliases). */
export function bindDiscoveryContext(project: Project, cwd: string, tsconfigPath: string): void {
  setDiscoveryContext(project, {
    projectRoot: cwd,
    tsconfigPaths: loadTsconfigPaths(tsconfigPath),
  });
}

/**
 * Run route extraction over every CONTROLLER source file currently in the
 * project. Only files matching the controller glob are extraction roots; DTO and
 * other imported files are pulled into the Project lazily during resolution but
 * are not themselves extraction roots. The cold path's loop visits all source
 * files, but at that point the Project contains ONLY the globbed controllers
 * (DTOs are added mid-extraction), so iterating `controllerPaths` is equivalent
 * — and necessary for the persistent Project, whose `getSourceFiles()` also
 * holds accumulated DTOs that must not be treated as controllers.
 */
export function extractRoutesFrom(
  project: Project,
  controllerPaths: Iterable<string>,
): RouteDescriptor[] {
  const routes: RouteDescriptor[] = [];
  for (const path of controllerPaths) {
    const sourceFile = project.getSourceFile(path);
    if (sourceFile) routes.push(...extractFromSourceFile(sourceFile, project));
  }
  return routes;
}

/**
 * Run route extraction over every source file currently in the project.
 * Byte-identical to the cold path's extraction loop — used by both.
 */
export function extractAllRoutes(project: Project): RouteDescriptor[] {
  const routes: RouteDescriptor[] = [];
  for (const sourceFile of project.getSourceFiles()) {
    routes.push(...extractFromSourceFile(sourceFile, project));
  }
  return routes;
}

/**
 * A persistent-Project discovery session for watch mode. Holds ONE ts-morph
 * `Project` for the watcher's lifetime, re-globbing the controller set and
 * re-parsing only the file(s) that changed on each rediscovery — avoiding the
 * dominant cost of rebuilding the Project and re-parsing every controller + DTO
 * from scratch on every debounced change.
 *
 * Correctness: the per-Project resolution memoization (`_findTypeCache`,
 * `_resolveNamedRefCache`, `_enumCache`) no longer auto-invalidates because the
 * Project is reused, so {@link rediscover} clears those caches on every pass.
 * Output is byte-identical to {@link discoverContractsFast}: same Project config,
 * same context binding, same extraction over the globbed controller set.
 */
export class PersistentDiscovery {
  private readonly project: Project;
  private readonly cwd: string;
  private readonly glob: string;
  /** Absolute paths of the controllers currently loaded as extraction roots. */
  private controllerPaths = new Set<string>();

  private constructor(project: Project, cwd: string, glob: string) {
    this.project = project;
    this.cwd = cwd;
    this.glob = glob;
  }

  /**
   * Build the initial persistent Project: create it, glob + add all controllers,
   * bind the discovery context. Mirrors {@link discoverContractsFast}'s setup.
   */
  static async create(opts: FastDiscoveryOptions): Promise<PersistentDiscovery> {
    const { cwd, glob, tsconfig } = opts;
    const tsconfigPath = resolveTsconfigPath(cwd, tsconfig);
    const project = createDiscoveryProject(tsconfigPath);
    bindDiscoveryContext(project, cwd, tsconfigPath);

    const instance = new PersistentDiscovery(project, cwd, glob);
    const files = await fg(glob, { cwd, absolute: true, onlyFiles: true });
    for (const f of files) {
      project.addSourceFileAtPath(f);
      instance.controllerPaths.add(f);
    }
    return instance;
  }

  /** Run the initial extraction (equivalent to a first `discoverContractsFast`). */
  discover(): RouteDescriptor[] {
    return this.runExtraction();
  }

  /**
   * Re-discover after one or more files changed. Refreshes the changed file(s)
   * from disk (controllers AND any lazily-loaded DTO/imported files), re-globs
   * to pick up added/removed controllers, clears the per-Project caches, then
   * re-extracts. `changedPaths` is a hint; correctness does not depend on it
   * being exhaustive because re-globbing + refresh-on-presence covers the set.
   */
  async rediscover(changedPaths?: Iterable<string>): Promise<RouteDescriptor[]> {
    // 1. Refresh explicitly-changed files that are already in the Project. This
    //    re-parses ONLY those files (the expensive ts-morph parse) — DTOs that
    //    didn't change keep their already-parsed AST.
    if (changedPaths) {
      for (const p of changedPaths) {
        const abs = resolve(p);
        const sf = this.project.getSourceFile(abs);
        if (sf) {
          await sf.refreshFromFileSystem();
        }
      }
    }

    // 2. Re-glob to reconcile the controller set: add new controllers, drop
    //    removed ones. Re-glob is cheap relative to parsing.
    const globbed = new Set(
      await fg(this.glob, { cwd: this.cwd, absolute: true, onlyFiles: true }),
    );
    for (const f of globbed) {
      if (!this.controllerPaths.has(f)) {
        try {
          this.project.addSourceFileAtPath(f);
          this.controllerPaths.add(f);
        } catch {
          /* file vanished between glob and add — ignore */
        }
      }
    }
    for (const f of this.controllerPaths) {
      if (!globbed.has(f)) {
        const sf = this.project.getSourceFile(f);
        if (sf) this.project.removeSourceFile(sf);
        this.controllerPaths.delete(f);
      }
    }

    return this.runExtraction();
  }

  /** Clear stale per-Project caches, then extract over the controller set. */
  private runExtraction(): RouteDescriptor[] {
    clearTypeResolutionCaches(this.project);
    clearEnumCache(this.project);
    return extractRoutesFrom(this.project, this.controllerPaths);
  }
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
  // `@Sse('path')` is a server-sent-events endpoint — a GET on the wire.
  const sseDecorator = method.getDecorator('Sse');
  if (sseDecorator) {
    const pathArg = sseDecorator.getArguments()[0];
    return { httpMethod: 'GET', handlerPath: decoratorStringArg(pathArg) ?? '' };
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
  project: Project;
  seenNames: Map<string, string>;
}): RouteDescriptor | null {
  const {
    cls,
    method,
    applyContractDecorator,
    verb,
    prefix,
    className,
    sourceFile,
    project,
    seenNames,
  } = args;

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
    // Resolve the const — locally OR by following imports / barrel re-exports to
    // its declaring file (ts-morph walks the import to the declaration).
    const resolvedVar = resolveImportedVariable(identName, sourceFile, project);
    if (!resolvedVar) {
      console.warn(
        `[nestjs-codegen/fast] Cannot resolve contract identifier '${identName}' applied in ${sourceFile.getFilePath()} — the import could not be followed to a declaration; skipping`,
      );
      return null;
    }

    const { decl: varDecl, file: declFile } = resolvedVar;
    const initializer = varDecl.getInitializer();
    if (!initializer) return null;

    contractDef = parseDefineContractCall(initializer);
    // Re-export the named contract's schema members (Path A). Only when the
    // const is exported so forms.ts can import it. The ref points at the const's
    // DECLARING file (which may differ from the controller for a cross-file ref),
    // and uses the LOCAL alias the controller imported it under for re-export.
    if (contractDef && varDecl.isExported()) {
      const filePath = declFile.getFilePath();
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
      error: contractDef.error,
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
      error: dtoContract?.error ?? null,
      queryRef: dtoContract?.queryRef ?? null,
      bodyRef: dtoContract?.bodyRef ?? null,
      responseRef: dtoContract?.responseRef ?? null,
      errorRef: dtoContract?.errorRef ?? null,
      filterFields: dtoContract?.filterFields ?? null,
      filterFieldTypes: dtoContract?.filterFieldTypes ?? null,
      filterSource: dtoContract?.filterSource ?? null,
      formWarnings: dtoContract?.formWarnings ?? [],
      bodySchema: dtoContract?.bodySchema ?? null,
      querySchema: dtoContract?.querySchema ?? null,
      stream: dtoContract?.stream ?? false,
      multipart: dtoContract?.multipart ?? false,
      multipartBody: dtoContract?.multipartBody ?? null,
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
            project,
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
