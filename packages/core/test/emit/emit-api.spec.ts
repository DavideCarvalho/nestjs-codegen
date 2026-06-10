import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/config/define-config.js';
import type { RouteDescriptor } from '../../src/discovery/route-model.js';
import { buildApiFile } from '../../src/emit/emit-api.js';

const routes: RouteDescriptor[] = [
  { name: 'users.list', method: 'GET', path: '/users', contract: { responseType: 'User[]' } },
  { name: 'users.show', method: 'GET', path: '/users/:id', contract: { responseType: 'User' } },
  {
    name: 'users.create',
    method: 'POST',
    path: '/users',
    contract: { responseType: 'User', bodyType: 'CreateUserDto' },
  },
];

describe('buildApiFile', () => {
  it('query OFF: plain fetcher calls, no tanstack import', () => {
    const out = buildApiFile(routes, resolveConfig({ outDir: '/tmp', query: false }));
    expect(out).not.toContain('@tanstack/query-core');
    expect(out).toContain("import { fetcher } from './fetcher.js';");
    expect(out).toContain('fetcher.get<User[]>("/users", input)');
    expect(out).toContain('fetcher.post<User>("/users", input)');
    // nested by dotted name
    expect(out).toContain('users: {');
    expect(out).toContain('list:');
    expect(out).toContain('create:');
  });

  it('query ON: framework-agnostic queryOptions/mutationOptions from query-core', () => {
    const out = buildApiFile(routes, resolveConfig({ outDir: '/tmp', query: true }));
    expect(out).toContain("import { mutationOptions, queryOptions } from '@tanstack/query-core';");
    expect(out).toContain('queryOptions({');
    expect(out).toContain('queryKey: ["users.show", input] as const');
    expect(out).toContain('mutationOptions({');
    expect(out).toContain('mutationFn: (input:');
    expect(out).toContain('fetcher.post<User>("/users", input)');
  });

  it('custom fetcherModule is honored', () => {
    const out = buildApiFile(routes, resolveConfig({ outDir: '/tmp', fetcherModule: '~/lib/api' }));
    expect(out).toContain("import { fetcher } from '~/lib/api';");
  });

  it('empty routes → empty api', () => {
    expect(buildApiFile([], resolveConfig({ outDir: '/tmp' }))).toContain('export const api = {}');
  });

  describe("mutationClient: 'inertia' (nestjs-inertia integration)", () => {
    const cfg = resolveConfig({ outDir: '/tmp', mutationClient: 'inertia', query: true });

    it('mutations become Inertia router visits; GET reads stay typed via fetcher', () => {
      const out = buildApiFile(routes, cfg);
      expect(out).toContain("import { router, type VisitOptions } from '@inertiajs/react';");
      expect(out).toContain('function withParams(');
      // create (POST) → router.post visit, not fetcher/mutationOptions
      expect(out).toContain(
        'router.post(withParams("/users", input?.params), input?.body, input?.options)',
      );
      expect(out).not.toContain('mutationOptions');
      // GET reads still use query-core + fetcher
      expect(out).toContain("import { queryOptions } from '@tanstack/query-core';");
      expect(out).toContain('fetcher.get<User[]>("/users", input)');
    });

    it('PUT with path params interpolates via withParams', () => {
      const out = buildApiFile(
        [
          {
            name: 'users.update',
            method: 'PUT',
            path: '/users/:id',
            contract: { bodyType: 'UpdateUserDto' },
          },
        ],
        cfg,
      );
      expect(out).toContain(
        'router.put(withParams("/users/:id", input?.params), input?.body, input?.options)',
      );
    });
  });
});
