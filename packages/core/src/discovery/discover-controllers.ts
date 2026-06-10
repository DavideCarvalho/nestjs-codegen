/**
 * AST-based discovery of NestJS controllers → {@link RouteDescriptor}[]. Covers the
 * common case: `@Controller('prefix')` classes with `@Get`/`@Post`/… handler methods,
 * `@Body()`/`@Query()` DTOs (translated to the validation IR), and response/body type
 * text from the method signature. Optional `@As('name')` overrides the route name.
 *
 * Out of scope here (handled by nestjs-inertia's richer pipeline): `defineContract`,
 * `@ApplyContract`, filter types, and cross-app route discovery via a live Nest app.
 */
import {
  type ClassDeclaration,
  type Decorator,
  type MethodDeclaration,
  Node,
  Project,
  type SourceFile,
} from 'ts-morph';
import { extractSchemaFromDto } from './dto-to-ir.js';
import type { HttpMethod, RouteContract, RouteDescriptor } from './route-model.js';
import { findType } from './type-ref-resolution.js';

export interface DiscoverOptions {
  /** Controller file paths (glob or exact). Ignored when `project` is supplied. */
  files?: string[];
  /** tsconfig path for a fresh Project. Ignored when `project` is supplied. */
  tsConfigPath?: string;
  /** Pre-built ts-morph Project (tests / reuse). When set, its source files are scanned. */
  project?: Project;
}

const HTTP_METHOD_DECORATORS: Record<string, HttpMethod> = {
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Patch: 'PATCH',
  Delete: 'DELETE',
};

/** First string-literal argument of a decorator, if any. */
function stringArg(decorator: Decorator | undefined): string | undefined {
  const arg = decorator?.getArguments()[0];
  if (arg && Node.isStringLiteral(arg)) return arg.getLiteralValue();
  return undefined;
}

/** `UsersController` → `users`. */
function deriveClassSegment(className: string): string {
  const noSuffix = className.replace(/Controller$/, '');
  if (!noSuffix) {
    throw new Error(
      `Controller class name "${className}" derives an empty route segment after stripping "Controller". Add @As(...) at the class level.`,
    );
  }
  return noSuffix.charAt(0).toLowerCase() + noSuffix.slice(1);
}

/** Join two URL path segments, normalising slashes. */
export function joinPaths(prefix: string, suffix: string): string {
  if (!prefix && !suffix) return '/';
  if (!prefix) return suffix.startsWith('/') ? suffix : `/${suffix}`;
  if (!suffix) return prefix.startsWith('/') ? prefix : `/${prefix}`;
  const p = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const s = suffix.startsWith('/') ? suffix : `/${suffix}`;
  const combined = p + s;
  return combined.startsWith('/') ? combined : `/${combined}`;
}

/** Resolve a `@Body()`/`@Query()` param's DTO class declaration, if it is a local/imported class. */
function resolveParamClass(
  method: MethodDeclaration,
  decoratorName: 'Body' | 'Query',
  sourceFile: SourceFile,
  project: Project,
): { decl: ClassDeclaration; file: SourceFile } | null {
  for (const param of method.getParameters()) {
    if (!param.getDecorators().some((d) => d.getName() === decoratorName)) continue;
    const typeNode = param.getTypeNode();
    if (!typeNode) continue;
    const text = typeNode.getText().replace(/\[\]$/, '');
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text)) continue;
    const resolved = findType(text, sourceFile, project);
    if (resolved && resolved.kind === 'class') return { decl: resolved.decl, file: resolved.file };
  }
  return null;
}

/** TS type text of the first param decorated with `decoratorName` (no-arg form). */
function paramTypeText(
  method: MethodDeclaration,
  decoratorName: 'Body' | 'Query',
): string | undefined {
  for (const param of method.getParameters()) {
    const dec = param.getDecorators().find((d) => d.getName() === decoratorName);
    if (!dec || dec.getArguments().length > 0) continue;
    return param.getTypeNode()?.getText();
  }
  return undefined;
}

/** Method return type text, unwrapping a single `Promise<...>`; `unknown` when absent. */
function responseTypeText(method: MethodDeclaration): string {
  const rt = method.getReturnTypeNode()?.getText();
  if (!rt) return 'unknown';
  const m = rt.match(/^Promise<(.+)>$/s);
  return (m ? m[1] : rt) as string;
}

function extractFromSourceFile(sourceFile: SourceFile, project: Project): RouteDescriptor[] {
  const routes: RouteDescriptor[] = [];
  for (const cls of sourceFile.getClasses()) {
    const controllerDecorator = cls.getDecorator('Controller');
    if (!controllerDecorator) continue;
    const prefix = stringArg(controllerDecorator) ?? '';
    const className = cls.getName() ?? 'Unknown';
    const classAs = stringArg(cls.getDecorator('As'));
    const classSegment = classAs ?? deriveClassSegment(className);

    for (const method of cls.getMethods()) {
      let httpMethod: HttpMethod | undefined;
      let handlerPath = '';
      for (const [decoratorName, verb] of Object.entries(HTTP_METHOD_DECORATORS)) {
        const dec = method.getDecorator(decoratorName);
        if (dec) {
          httpMethod = verb;
          handlerPath = stringArg(dec) ?? '';
          break;
        }
      }
      if (!httpMethod) continue;

      const methodName = method.getName();
      const methodAs = stringArg(method.getDecorator('As'));
      const name = `${classSegment}.${methodAs ?? methodName}`;
      const path = joinPaths(prefix, handlerPath);

      const contract: RouteContract = { responseType: responseTypeText(method) };
      const bodyText = paramTypeText(method, 'Body');
      if (bodyText) contract.bodyType = bodyText;

      const bodyClass = resolveParamClass(method, 'Body', sourceFile, project);
      if (bodyClass) contract.body = extractSchemaFromDto(bodyClass.decl, bodyClass.file, project);
      const queryClass = resolveParamClass(method, 'Query', sourceFile, project);
      if (queryClass)
        contract.query = extractSchemaFromDto(queryClass.decl, queryClass.file, project);

      routes.push({ name, method: httpMethod, path, contract });
    }
  }
  return routes;
}

/** Scan every source file already in `project` for controllers. */
export function discoverRoutesFromProject(project: Project): RouteDescriptor[] {
  const routes: RouteDescriptor[] = [];
  for (const sf of project.getSourceFiles()) routes.push(...extractFromSourceFile(sf, project));
  return routes;
}

/** Discover routes from controller files (or a supplied Project). */
export function discoverRoutes(options: DiscoverOptions): RouteDescriptor[] {
  if (options.project) return discoverRoutesFromProject(options.project);
  const project = options.tsConfigPath
    ? new Project({ tsConfigFilePath: options.tsConfigPath, skipAddingFilesFromTsConfig: true })
    : new Project({ skipAddingFilesFromTsConfig: true, compilerOptions: { allowJs: true } });
  if (options.files) project.addSourceFilesAtPaths(options.files);
  return discoverRoutesFromProject(project);
}
