import type { Project } from 'ts-morph';
import type { ResolvedConfig } from '../config/types.js';
import type { RouteDescriptor } from '../discovery/types.js';

/**
 * The published, versioned extension contract for `@dudousxd/nestjs-codegen`.
 *
 * Extensions are **build-time** objects (usually returned by a factory so they can take
 * options) registered explicitly via `forRoot({ extensions: [...] })`. The host runs them
 * around the core discovery → IR → emit pipeline.
 *
 * Hooks split into **multi** (every extension runs; results accumulate or chain) and
 * **single-slot** (at most one extension may claim it — two claimers is a hard error).
 *
 * @remarks Semver 0.x — the shape may change until 1.0. Out-of-repo extensions should pin
 * a compatible `@dudousxd/nestjs-codegen` peer range.
 */
export interface CodegenExtension {
  /** Unique id. Used in conflict/collision errors and for deterministic ordering. */
  name: string;

  // ── multi hooks (every extension runs) ────────────────────────────────────

  /**
   * Mutate/augment the route IR before emit. Runs in registration order, chained
   * (each extension sees the previous one's output). Return the new array, or mutate
   * in place and return void. Example: the filter extension attaches `filterFields` to
   * matching routes here.
   */
  transformRoutes?(
    routes: RouteDescriptor[],
    ctx: ExtensionContext,
  ): RouteDescriptor[] | undefined | Promise<RouteDescriptor[] | undefined>;

  /**
   * Contribute extra output files (additive). Paths are relative to `outDir`; a path
   * claimed by two extensions is a hard error. Example: the Inertia extension does its
   * own page discovery via `ctx.project()` and emits `pages.d.ts` + `components.json`.
   */
  emitFiles?(ctx: ExtensionContext): EmittedFile[] | Promise<EmittedFile[]>;

  /**
   * Contribute top-level code to `api.ts` (imports + statements). Runs in registration
   * order; imports are deduped by the host. Example: the Inertia extension adds
   * `import { router } from '@inertiajs/react'` and the `navigate()` helper.
   */
  apiHeader?(ctx: ExtensionContext): ApiHeaderContribution | undefined;

  /**
   * Add named members to a **handle** leaf. Only runs when a client layer is active
   * (i.e. the leaf is a handle, not a bare callable). Member-name collisions across
   * extensions are a hard error. Example: the filter extension adds `filterQuery` to
   * leaves whose route carries `filterFields`.
   */
  apiMembers?(leaf: LeafModel, ctx: ExtensionContext): Record<string, string> | undefined;

  // ── single-slot hooks (at most one extension) ─────────────────────────────

  /**
   * Claims **how** a single endpoint issues its request. When unset by every extension,
   * the host falls back to the neutral fetcher transport. Example: the Inertia extension
   * routes mutations through the Inertia router while GETs stay fetcher-typed.
   */
  apiTransport?: ApiTransport;

  /**
   * Claims **what** a leaf returns. When unset, a leaf is a bare callable returning a
   * `Promise`. Example: the TanStack extension wraps each leaf into a handle exposing
   * `{ fetch, queryKey, queryOptions | mutationOptions }`.
   */
  apiClientLayer?: ApiClientLayer;
}

/** Shared, read-only context handed to every extension hook. */
export interface ExtensionContext {
  cwd: string;
  outDir: string;
  routes: readonly RouteDescriptor[];
  config: ResolvedConfig;
  /** Lazily-created shared ts-morph Project for AST work (pages, custom decorators). */
  project(): Project;
}

/** A file contributed by an extension's `emitFiles` hook. */
export interface EmittedFile {
  /** Path relative to `outDir`. A collision across extensions throws. */
  path: string;
  contents: string;
}

/** Top-level `api.ts` contributions from an extension's `apiHeader` hook. */
export interface ApiHeaderContribution {
  /** Raw import lines (e.g. `import { router } from '@inertiajs/react';`), deduped by the host. */
  imports?: string[];
  /** Top-level statements appended after the api factory (e.g. the `navigate()` helper). */
  statements?: string[];
}

/**
 * The neutral, per-endpoint request model the host builds for each leaf before any
 * transport/layer runs. Extensions read this to render their output.
 */
export interface RequestModel {
  /** Dot-path route name, e.g. `users.show`. */
  routeName: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  isGet: boolean;
  hasParams: boolean;
  hasBody: boolean;
  /** Type of the leaf's `input` arg, e.g. `{ params: ...; query?: ... }` or `Record<string, never>`. */
  inputType: string;
  /** URL expression, e.g. `route('users.show', input?.params) || '/api/users/:id'`. */
  urlExpr: string;
  /** Request-options expression, e.g. `{ query: ... }` or `{ body: input?.body }`. */
  optsExpr: string;
  /** Response type access, e.g. `ApiRouter['users']['show']['response']`. */
  responseType: string;
  /** Body type access, e.g. `ApiRouter['users']['create']['body']` (for mutation layers). */
  bodyType: string;
  /** Stable query-key expression, e.g. `["users.show", input] as const`. */
  queryKeyExpr: string;
}

/**
 * Per-leaf model passed through the api.ts pipeline: transport → layer → member
 * contributors → render. `requestExpr` is set by the transport; `members`, when present,
 * flips the leaf from a bare callable to a handle.
 */
export interface LeafModel {
  route: RouteDescriptor;
  request: RequestModel;
  /** The expression that issues the request (set by the transport, default = fetcher). */
  requestExpr: string;
  /** When present, the leaf renders as a handle exposing these members (ordered). */
  members?: Record<string, string>;
}

/**
 * Top-level `api.ts` imports + helpers a transport or layer depends on. Functions of the
 * context so they can be route-aware (e.g. only import `mutationOptions` when a mutation
 * exists). Imports are deduped by the host across all extensions.
 */
export interface ApiModuleDeps {
  /** Raw import lines (e.g. `import { queryOptions as _q } from '@tanstack/react-query';`). */
  imports?(ctx: ExtensionContext): string[];
  /** Module-level helper declarations the rendered expressions depend on. */
  helpers?(ctx: ExtensionContext): string[];
}

/** Single-slot: decides how an endpoint issues its request. */
export interface ApiTransport extends ApiModuleDeps {
  name: string;
  /** Render the expression that issues this endpoint's request (e.g. `fetcher.get<Res>(url, opts)`). */
  renderRequest(leaf: LeafModel, ctx: ExtensionContext): string;
}

/** Single-slot: decides what a leaf returns (the handle members). */
export interface ApiClientLayer extends ApiModuleDeps {
  name: string;
  /**
   * Given the request expression (from the transport) and the leaf, return the handle's
   * members as an ordered `name → value` map (value is the expression after `name: `).
   * Returning members flips the leaf from a bare callable to a handle.
   */
  buildMembers(requestExpr: string, leaf: LeafModel, ctx: ExtensionContext): Record<string, string>;
}

/** Identity helper for authoring extensions with full type inference. */
export function defineExtension(ext: CodegenExtension): CodegenExtension {
  return ext;
}
