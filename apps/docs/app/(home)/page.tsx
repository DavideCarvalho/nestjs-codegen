import Link from 'next/link';

/** An editor-style window: chrome strip with traffic-light dots + a mono filename. */
function CodeWindow({ file, children }: { file: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-fd-border px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-fd-border" />
          <span className="size-2.5 rounded-full bg-fd-border" />
          <span className="size-2.5 rounded-full bg-fd-border" />
        </span>
        <span className="font-mono text-xs text-fd-muted-foreground">{file}</span>
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed font-mono text-fd-foreground">
        <code>{children}</code>
      </pre>
    </div>
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
    body: 'Emits queryOptions / mutationOptions from your @tanstack adapter (react/vue/svelte/solid). No query-core to install.',
  },
  {
    title: 'Bring your own fetcher',
    body: 'Native fetch by default, or plug an axios instance via axiosTransport(). superjson + transformer pipelines too.',
  },
  {
    title: 'nestjs-inertia integration',
    body: 'Pages, shared props, components.json, and typed Inertia router navigation — all generated.',
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
      <section className="in-stagger mx-auto flex w-full max-w-5xl flex-col items-start gap-6 px-6 pt-20 pb-14">
        <span className="inline-flex items-center gap-2 rounded-full border border-fd-border px-3 py-1 font-mono text-xs text-fd-muted-foreground">
          <span aria-hidden className="size-2 rounded-full bg-violet-400 animate-in-blink" />
          typed-client codegen for NestJS
        </span>

        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Generate a <span className="text-fd-primary">fully-typed client</span> from your NestJS
          app.
        </h1>

        <p className="max-w-2xl text-lg text-fd-muted-foreground">
          Point it at your controllers and contracts. Out come typed routes, a typed API client,
          and validation schemas — with pluggable validation libs, optional TanStack Query, and a
          bring-your-own fetcher. Works with or without Inertia.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/docs"
            className="rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-semibold text-fd-primary-foreground transition-opacity hover:opacity-90"
          >
            Get started →
          </Link>
          <Link
            href="/docs/cli"
            className="rounded-lg border border-fd-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-fd-accent"
          >
            CLI reference
          </Link>
        </div>

        <div className="w-full pt-2">
          <CodeWindow file="terminal">{`pnpm add -D @dudousxd/nestjs-codegen
npx nestjs-codegen codegen`}</CodeWindow>
        </div>
      </section>

      {/* Before / after */}
      <section className="mx-auto grid w-full max-w-5xl gap-4 px-6 pb-14 md:grid-cols-2">
        <CodeWindow file="users.controller.ts">{`@Controller('users')
export class UsersController {
  @Get(':id')
  show(@Param('id') id: string): Promise<User> {}

  @Post()
  create(@Body() dto: CreateUserDto): Promise<User> {}
}`}</CodeWindow>
        <CodeWindow file="users-page.tsx">{`import { createApi } from './generated/api';
import { createFetcher } from '@dudousxd/nestjs-client';

const api = createApi(createFetcher({ baseUrl: '/api' }));

// GET /users/:id  → typed User
useQuery(api.users.show({ params: { id } }));

// POST /users     → typed body + response
useMutation(api.users.create());`}</CodeWindow>
      </section>

      {/* Features */}
      <section className="mx-auto w-full max-w-5xl px-6 pb-24">
        <p className="mb-4 font-mono text-xs uppercase tracking-wider text-fd-muted-foreground">
          everything is pluggable
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-fd-border bg-fd-card p-5 transition-colors hover:border-fd-primary/40"
            >
              <h3 className="mb-1.5 font-semibold">{f.title}</h3>
              <p className="text-sm text-fd-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
