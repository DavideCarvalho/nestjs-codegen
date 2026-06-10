import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { discoverRoutesFromProject, joinPaths } from '../../src/discovery/discover-controllers.js';

function discover(files: Record<string, string>) {
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  for (const [name, src] of Object.entries(files)) project.createSourceFile(name, src);
  return discoverRoutesFromProject(project);
}

describe('joinPaths', () => {
  it('normalises slashes', () => {
    expect(joinPaths('users', ':id')).toBe('/users/:id');
    expect(joinPaths('/users/', '/:id')).toBe('/users/:id');
    expect(joinPaths('', '')).toBe('/');
  });
});

describe('discoverRoutesFromProject', () => {
  it('extracts routes, names, methods, and paths from a controller', () => {
    const routes = discover({
      'users.controller.ts': `
        @Controller('users')
        class UsersController {
          @Get() list() {}
          @Get(':id') show() {}
          @Post() create() {}
        }
      `,
    });
    expect(routes).toEqual([
      { name: 'users.list', method: 'GET', path: '/users', contract: { responseType: 'unknown' } },
      {
        name: 'users.show',
        method: 'GET',
        path: '/users/:id',
        contract: { responseType: 'unknown' },
      },
      {
        name: 'users.create',
        method: 'POST',
        path: '/users',
        contract: { responseType: 'unknown' },
      },
    ]);
  });

  it('honors @As overrides at class and method level', () => {
    const routes = discover({
      'a.controller.ts': `
        @As('account')
        @Controller('me')
        class ProfileController {
          @As('fetch')
          @Get() get() {}
        }
      `,
    });
    expect(routes[0]?.name).toBe('account.fetch');
    expect(routes[0]?.path).toBe('/me');
  });

  it('translates @Body DTO to the validation IR + captures body/response type text', () => {
    const routes = discover({
      'auth.controller.ts': `
        class LoginDto { @IsEmail() email!: string; @MinLength(8) password!: string; }
        @Controller('auth')
        class AuthController {
          @Post('login') login(@Body() dto: LoginDto): Promise<{ token: string }> { return null as any; }
        }
      `,
    });
    const r = routes[0];
    expect(r?.name).toBe('auth.login');
    expect(r?.method).toBe('POST');
    expect(r?.path).toBe('/auth/login');
    expect(r?.contract?.bodyType).toBe('LoginDto');
    expect(r?.contract?.responseType).toBe('{ token: string }'); // Promise unwrapped
    expect(r?.contract?.body?.root).toEqual({
      kind: 'object',
      passthrough: false,
      fields: [
        { key: 'email', value: { kind: 'string', checks: [{ check: 'email' }] } },
        { key: 'password', value: { kind: 'string', checks: [{ check: 'min', value: '8' }] } },
      ],
    });
  });

  it('ignores non-controller classes and non-HTTP methods', () => {
    const routes = discover({
      's.ts': 'class Service { doThing() {} } @Controller() class C { helper() {} @Get() ping() {} }',
    });
    expect(routes).toHaveLength(1);
    expect(routes[0]?.name).toBe('c.ping');
  });
});
