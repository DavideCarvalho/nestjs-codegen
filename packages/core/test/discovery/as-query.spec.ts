/**
 * `@AsQuery()` marker discovery: a non-GET route decorated with the no-op
 * `@dudousxd/nestjs-codegen/markers` decorator is flagged `asQuery: true` on
 * its contract, which flips `requestShape().isQuery` to true (see
 * `extension/types.ts`) so client layers emit `queryOptions` for it.
 */
import { Project, type SourceFile } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractDtoContract } from '../../src/discovery/contracts-fast.js';
import { requestShape } from '../../src/extension/types.js';

function makeSourceFileFromCode(code: string): { sf: SourceFile; project: Project } {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipLoadingLibFiles: true,
    skipFileDependencyResolution: true,
    compilerOptions: { strict: false },
  });
  const sf = project.createSourceFile('test.ts', code);
  return { sf, project };
}

function contractFor(code: string, methodName: string) {
  const { sf, project } = makeSourceFileFromCode(code);
  const cls = sf.getClassOrThrow('TestController');
  const method = cls.getMethodOrThrow(methodName);
  return extractDtoContract(method, sf, project);
}

describe('@AsQuery() marker discovery', () => {
  it('flags a decorated POST route asQuery: true', () => {
    const result = contractFor(
      `
      class SearchDto { term: string; }
      class TestController {
        @Post('search')
        @AsQuery()
        search(@Body() body: SearchDto) {}
      }
    `,
      'search',
    );
    expect(result?.asQuery).toBe(true);
  });

  it('leaves an undecorated POST route asQuery falsy', () => {
    const result = contractFor(
      `
      class CreateDto { name: string; }
      class TestController {
        @Post()
        create(@Body() body: CreateDto) {}
      }
    `,
      'create',
    );
    expect(result?.asQuery).toBeFalsy();
  });

  it('requestShape() treats an @AsQuery() POST as a read (isQuery: true)', () => {
    const route = {
      method: 'POST',
      path: '/api/search',
      name: 'search',
      params: [],
      contract: {
        contractSource: {
          query: null,
          body: '{ term: string }',
          response: 'unknown',
          asQuery: true,
        },
      },
    };
    const shape = requestShape(route);
    expect(shape.isQuery).toBe(true);
    expect(shape.isGet).toBe(false);
  });

  it('requestShape() leaves a plain POST as a write (isQuery: false)', () => {
    const route = {
      method: 'POST',
      path: '/api/create',
      name: 'create',
      params: [],
      contract: {
        contractSource: { query: null, body: '{ name: string }', response: 'unknown' },
      },
    };
    const shape = requestShape(route);
    expect(shape.isQuery).toBe(false);
  });
});
