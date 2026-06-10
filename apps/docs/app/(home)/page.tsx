import Link from 'next/link';

const ACCENT = '#e0234e';

function Pre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-fd-border bg-fd-card p-4 text-[13px] leading-relaxed font-mono text-fd-foreground">
      <code>{children}</code>
    </pre>
  );
}

const FEATURES: Array<{ title: string; body: string }> = [
  {
    title: 'Pluggable validation',
    body: 'One neutral schema IR → zod (bundled), valibot, or arktype adapters. Standard-Schema-shaped — bring your own.',
  },
  {
    title: 'Typed API client',
    body: 'A Tuyau-style createApi(fetcher) factory: inject your fetcher at runtime. Nested, fully typed by route name.',
  },
  {
    title: 'TanStack Query, optional',
    body: 'Emits queryOptions / mutationOptions from your @tanstack adapter (react/vue/svelte/solid). No query-core needed.',
  },
  {
    title: 'Bring your own fetcher',
    body: 'Native fetch by default, or plug an axios instance via axiosTransport(). superjson + transformer pipelines too.',
  },
  {
    title: 'nestjs-inertia integration',
    body: 'Pages, shared props, components.json, and Inertia router navigation — all generated.',
  },
  {
    title: 'nestjs-filter integration',
    body: 'Discovers @FilterFor / @ApplyFilter and emits TypedFilterQuery against @dudousxd/nestjs-filter-client.',
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Hero */}
      <section className="mx-auto flex w-full max-w-5xl flex-col items-start gap-6 px-6 pt-20 pb-12">
        <span
          className="inline-flex items-center gap-2 rounded-full border border-fd-border px-3 py-1 font-mono text-xs text-fd-muted-foreground"
          style={{ borderColor: `${ACCENT}55` }}
        >
          <span aria-hidden className="size-2 rounded-full" style={{ background: ACCENT }} />
          typed client codegen for NestJS
        </span>

        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Generate a <span style={{ color: ACCENT }}>fully-typed client</span> from your NestJS app.
        </h1>

        <p className="max-w-2xl text-lg text-fd-muted-foreground">
          Point it at your controllers and contracts. Out come typed routes, a typed API client,
          and validation schemas — with pluggable validation libs, optional TanStack Query, and a
          bring-your-own fetcher. Works with or without Inertia.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/docs"
            className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
            style={{ background: ACCENT }}
          >
            Get started →
          </Link>
          <Link
            href="/docs/cli"
            className="rounded-lg border border-fd-border px-5 py-2.5 text-sm font-semibold"
          >
            CLI reference
          </Link>
        </div>

        <div className="w-full pt-4">
          <Pre>{`pnpm add -D @dudousxd/nestjs-codegen
npx nestjs-codegen codegen`}</Pre>
        </div>
      </section>

      {/* Before / after */}
      <section className="mx-auto grid w-full max-w-5xl gap-4 px-6 pb-12 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs uppercase tracking-wider text-fd-muted-foreground">
            your NestJS controller
          </p>
          <Pre>{`@Controller('users')
export class UsersController {
  @Get(':id')
  show(@Param('id') id: string): Promise<User> { /* … */ }

  @Post()
  create(@Body() dto: CreateUserDto): Promise<User> { /* … */ }
}`}</Pre>
        </div>
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs uppercase tracking-wider text-fd-muted-foreground">
            generated client (typed end-to-end)
          </p>
          <Pre>{`import { createApi } from './generated/api';
import { createFetcher } from '@dudousxd/nestjs-client';

const api = createApi(createFetcher({ baseUrl: '/api' }));

// GET /users/:id  → typed User
useQuery(api.users.show({ params: { id } }));

// POST /users     → typed body + response
useMutation(api.users.create());`}</Pre>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto grid w-full max-w-5xl gap-4 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-xl border border-fd-border bg-fd-card p-5">
            <h3 className="mb-1.5 font-semibold">{f.title}</h3>
            <p className="text-sm text-fd-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
