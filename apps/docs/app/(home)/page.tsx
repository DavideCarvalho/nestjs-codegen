import Link from 'next/link';
import {
  ArrowRight,
  Braces,
  Layers,
  Link2,
  Plug,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wand2,
} from 'lucide-react';

const GITHUB_URL = 'https://github.com/DavideCarvalho/nestjs-codegen';

export default function HomePage() {
  return (
    <main className="relative flex flex-1 flex-col overflow-hidden">
      <BackgroundTexture />
      <Hero />
      <CodegenShowcase />
      <FeatureGrid />
      <WireItIn />
      <FinalCta />
    </main>
  );
}

function BackgroundTexture() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.35] dark:opacity-[0.5]"
        style={{
          backgroundImage:
            'radial-gradient(circle at center, var(--color-fd-border) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 20%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 20%, transparent 75%)',
        }}
      />
      <div
        className="absolute -top-40 left-1/2 h-[36rem] w-[60rem] -translate-x-1/2 rounded-full blur-[120px]"
        style={{
          background:
            'radial-gradient(circle, rgb(139 92 246 / 0.18) 0%, rgb(139 92 246 / 0.05) 40%, transparent 70%)',
        }}
      />
    </div>
  );
}

function Hero() {
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col items-center px-4 pb-10 pt-20 text-center sm:pt-28">
      <div className="in-stagger flex flex-col items-center">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card/60 px-3 py-1 font-mono text-xs text-fd-muted-foreground backdrop-blur">
          <span className="relative flex h-2 w-2">
            <span className="animate-in-blink absolute inline-flex h-2 w-2 rounded-full bg-violet-400" />
          </span>
          typed-client codegen for NestJS
        </span>

        <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
          Full type safety from{' '}
          <span className="bg-gradient-to-r from-violet-500 to-fuchsia-400 bg-clip-text text-transparent">
            controller to client.
          </span>
        </h1>

        <p className="mt-6 max-w-2xl text-pretty text-lg text-fd-muted-foreground">
          Point it at your NestJS controllers and DTOs. Out come typed routes, a typed API client,
          and validation schemas — with{' '}
          <strong className="text-fd-foreground">pluggable validation</strong> (zod / valibot /
          arktype), optional TanStack Query, and a{' '}
          <strong className="text-fd-foreground">bring-your-own fetcher</strong>. Works with or
          without Inertia.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs"
            className="group inline-flex items-center gap-2 rounded-lg bg-violet-500 px-5 py-2.5 font-medium text-zinc-950 shadow-[0_0_24px_-6px] shadow-violet-500/50 transition-all hover:bg-violet-400 hover:shadow-violet-400/60"
          >
            Get started
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/docs/getting-started"
            className="rounded-lg border border-fd-border bg-fd-card/40 px-5 py-2.5 font-medium backdrop-blur transition-colors hover:bg-fd-accent"
          >
            Install in 5 minutes
          </Link>
          <a
            href={GITHUB_URL}
            className="rounded-lg border border-fd-border bg-fd-card/40 px-5 py-2.5 font-medium backdrop-blur transition-colors hover:bg-fd-accent"
          >
            GitHub
          </a>
        </div>

        <p className="mt-6 font-mono text-xs text-fd-muted-foreground">
          zod · valibot · arktype · TanStack Query · axios / superjson · works without Inertia
        </p>
      </div>
    </section>
  );
}

interface CodeToken {
  text: string;
  cls?: string;
}

const BEFORE_LINES: readonly { tokens: CodeToken[] }[] = [
  { tokens: [{ text: '// hand-written client, drifts from the API', cls: 'text-zinc-600' }] },
  {
    tokens: [
      { text: 'export async function ', cls: 'text-violet-400' },
      { text: 'getUser', cls: 'text-sky-400' },
      { text: '(id: ' },
      { text: 'string', cls: 'text-amber-300' },
      { text: ') {' },
    ],
  },
  {
    tokens: [
      { text: '  const res = await ', cls: 'text-zinc-400' },
      { text: 'fetch', cls: 'text-sky-400' },
      { text: '(`/users/${id}`);' },
    ],
  },
  {
    tokens: [
      { text: '  return res.', cls: 'text-zinc-400' },
      { text: 'json', cls: 'text-sky-400' },
      { text: '() ' },
      { text: 'as', cls: 'text-violet-400' },
      { text: ' User', cls: 'text-amber-300' },
      { text: '; // 🤞' },
    ],
  },
  { tokens: [{ text: '}' }] },
  { tokens: [{ text: '// ...repeat for every endpoint, by hand', cls: 'text-zinc-600' }] },
];

const AFTER_LINES: readonly { tokens: CodeToken[] }[] = [
  {
    tokens: [
      { text: 'import', cls: 'text-violet-400' },
      { text: ' { createApi } ' },
      { text: 'from', cls: 'text-violet-400' },
      { text: " './generated/api'", cls: 'text-teal-300' },
      { text: ';' },
    ],
  },
  {
    tokens: [
      { text: 'import', cls: 'text-violet-400' },
      { text: ' { createFetcher } ' },
      { text: 'from', cls: 'text-violet-400' },
      { text: " '@dudousxd/nestjs-client'", cls: 'text-teal-300' },
      { text: ';' },
    ],
  },
  { tokens: [] },
  {
    tokens: [
      { text: 'const api = ' },
      { text: 'createApi', cls: 'text-sky-400' },
      { text: '(' },
      { text: 'createFetcher', cls: 'text-sky-400' },
      { text: '({ baseUrl: ' },
      { text: "'/api'", cls: 'text-teal-300' },
      { text: ' }));' },
    ],
  },
  { tokens: [] },
  { tokens: [{ text: '// typed params + response, no drift', cls: 'text-zinc-600' }] },
  {
    tokens: [
      { text: 'const user = await api.users.' },
      { text: 'show', cls: 'text-sky-400' },
      { text: '({ params: { id } });' },
    ],
  },
  { tokens: [] },
  { tokens: [{ text: '// opt in to TanStack Query', cls: 'text-zinc-600' }] },
  {
    tokens: [
      { text: 'useQuery', cls: 'text-sky-400' },
      { text: '(api.users.' },
      { text: 'show', cls: 'text-sky-400' },
      { text: '({ params: { id } }).' },
      { text: 'queryOptions', cls: 'text-sky-400' },
      { text: '());' },
    ],
  },
];

function CodePane({
  title,
  badge,
  badgeCls,
  lines,
  dimmed,
}: {
  title: string;
  badge: string;
  badgeCls: string;
  lines: readonly { tokens: CodeToken[] }[];
  dimmed?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/40 ring-1 ring-white/5">
      <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/70 px-4 py-3">
        <span className="size-3 rounded-full bg-zinc-700" />
        <span className="size-3 rounded-full bg-zinc-700" />
        <span className="size-3 rounded-full bg-zinc-700" />
        <span className="ml-3 font-mono text-xs text-zinc-500">{title}</span>
        <span className={`ml-auto font-mono text-[11px] ${badgeCls}`}>{badge}</span>
      </div>
      <pre
        className={`overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed ${dimmed ? 'opacity-60' : ''}`}
      >
        <code>
          {lines.map((line, lineIndex) => (
            <div key={lineIndex} className="whitespace-pre">
              {line.tokens.map((token, tokenIndex) => (
                <span key={tokenIndex} className={token.cls ?? 'text-zinc-300'}>
                  {token.text}
                </span>
              ))}
              {line.tokens.length === 0 ? ' ' : null}
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}

function CodegenShowcase() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-24">
      <div className="relative">
        <div
          aria-hidden
          className="absolute -inset-x-10 -bottom-8 top-10 -z-10 rounded-[2rem] bg-violet-500/10 blur-3xl"
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <CodePane
            title="lib/users-client.ts"
            badge="✗ by hand"
            badgeCls="text-zinc-500"
            lines={BEFORE_LINES}
            dimmed
          />
          <CodePane
            title="users-page.tsx"
            badge="✓ with codegen"
            badgeCls="text-violet-400"
            lines={AFTER_LINES}
          />
        </div>
      </div>
    </section>
  );
}

interface Feature {
  icon: typeof Braces;
  title: string;
  body: string;
  accent: string;
}

const FEATURES: readonly Feature[] = [
  {
    icon: Braces,
    title: 'Pluggable validation',
    body: 'One neutral schema IR → zod (bundled), valibot, or arktype. Standard-Schema-shaped, so adding a lib is one render function. Your DTOs are the source of truth.',
    accent: 'text-violet-400',
  },
  {
    icon: Wand2,
    title: 'Typed API client',
    body: 'A Tuyau-style createApi(fetcher) factory, nested by route name. Params, body, and response inferred from your controllers — wrong calls fail at compile time.',
    accent: 'text-sky-400',
  },
  {
    icon: Layers,
    title: 'TanStack Query, opt-in',
    body: 'By default each endpoint is a plain typed fetch. Turn on query and the same call exposes .queryOptions() / .mutationOptions() from your own @tanstack adapter.',
    accent: 'text-fuchsia-400',
  },
  {
    icon: Plug,
    title: 'Bring your own fetcher',
    body: 'Native fetch by default, or plug an axios instance via axiosTransport(). superjson and transformer pipelines preserve Date, Map & friends end-to-end.',
    accent: 'text-emerald-400',
  },
  {
    icon: Link2,
    title: 'nestjs-inertia integration',
    body: 'Optionally discover Inertia pages and shared props, augment InertiaPages, and emit a typed router navigate() — the same codegen, with Inertia switched on.',
    accent: 'text-amber-400',
  },
  {
    icon: ShieldCheck,
    title: 'nestjs-filter integration',
    body: 'Discovers @FilterFor / @ApplyFilter and emits a TypedFilterQuery over your filterable fields, wired to @dudousxd/nestjs-filter-client.',
    accent: 'text-teal-400',
  },
];

function FeatureGrid() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 pb-24">
      <div className="mb-10 text-center">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Typed wire, your stack
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-fd-muted-foreground">
          Everything between your NestJS controllers and your client is generated and
          type-checked — and every layer is yours to swap.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <FeatureCard key={feature.title} feature={feature} />
        ))}
      </div>
    </section>
  );
}

function FeatureCard({ feature }: { feature: Feature }) {
  const Icon = feature.icon;
  return (
    <div className="group relative overflow-hidden rounded-xl border border-fd-border bg-fd-card/50 p-5 backdrop-blur transition-colors hover:border-violet-500/40">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            'radial-gradient(120px circle at top right, rgb(139 92 246 / 0.1), transparent 70%)',
        }}
      />
      <div className="relative">
        <span className="inline-flex size-9 items-center justify-center rounded-lg border border-fd-border bg-fd-background/60">
          <Icon className={`size-4.5 ${feature.accent}`} />
        </span>
        <h3 className="mt-4 font-medium">{feature.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">{feature.body}</p>
      </div>
    </div>
  );
}

const MODULE_LINES: readonly { tokens: CodeToken[] }[] = [
  {
    tokens: [
      { text: 'import', cls: 'text-violet-400' },
      { text: ' { Module } ', cls: 'text-zinc-300' },
      { text: 'from', cls: 'text-violet-400' },
      { text: " '@nestjs/common'", cls: 'text-emerald-400' },
      { text: ';', cls: 'text-zinc-300' },
    ],
  },
  {
    tokens: [
      { text: 'import', cls: 'text-violet-400' },
      { text: ' { NestjsCodegenModule } ', cls: 'text-zinc-300' },
      { text: 'from', cls: 'text-violet-400' },
      { text: " '@dudousxd/nestjs-codegen/nest'", cls: 'text-emerald-400' },
      { text: ';', cls: 'text-zinc-300' },
    ],
  },
  { tokens: [] },
  {
    tokens: [
      { text: '@Module', cls: 'text-amber-300' },
      { text: '({', cls: 'text-zinc-300' },
    ],
  },
  {
    tokens: [
      { text: '  imports: [', cls: 'text-zinc-300' },
    ],
  },
  {
    tokens: [
      { text: '    NestjsCodegenModule.', cls: 'text-zinc-300' },
      { text: 'forRoot', cls: 'text-sky-300' },
      { text: '({', cls: 'text-zinc-300' },
    ],
  },
  {
    tokens: [
      { text: '      contracts: { glob: ', cls: 'text-zinc-300' },
      { text: "'src/**/*.controller.ts'", cls: 'text-emerald-400' },
      { text: ' },', cls: 'text-zinc-300' },
    ],
  },
  {
    tokens: [
      { text: '      codegen: { outDir: ', cls: 'text-zinc-300' },
      { text: "'src/generated'", cls: 'text-emerald-400' },
      { text: ' },', cls: 'text-zinc-300' },
    ],
  },
  {
    tokens: [{ text: '    }),', cls: 'text-zinc-300' }],
  },
  {
    tokens: [{ text: '  ],', cls: 'text-zinc-300' }],
  },
  {
    tokens: [{ text: '})', cls: 'text-zinc-300' }],
  },
  {
    tokens: [
      { text: 'export', cls: 'text-violet-400' },
      { text: ' class ', cls: 'text-violet-400' },
      { text: 'AppModule', cls: 'text-amber-300' },
      { text: ' {}', cls: 'text-zinc-300' },
    ],
  },
];

const CI_LINES: readonly { tokens: CodeToken[] }[] = [
  {
    tokens: [
      { text: '# CI / pre-deploy — fail the build if the client drifts', cls: 'text-zinc-500' },
    ],
  },
  {
    tokens: [
      { text: '$ ', cls: 'text-zinc-600' },
      { text: 'npx nestjs-codegen codegen', cls: 'text-zinc-300' },
    ],
  },
  {
    tokens: [
      { text: '✓', cls: 'text-emerald-400' },
      { text: ' routes.ts · api.ts · forms.ts regenerated', cls: 'text-zinc-500' },
    ],
  },
];

function WireItIn() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 pb-24">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div>
          <span className="font-mono text-xs uppercase tracking-wider text-violet-500">
            Wire it in
          </span>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Import the module. It runs itself.
          </h2>
          <p className="mt-4 text-fd-muted-foreground">
            Add{' '}
            <code className="rounded bg-fd-muted px-1.5 py-0.5 font-mono text-sm">
              NestjsCodegenModule.forRoot()
            </code>{' '}
            to your{' '}
            <code className="rounded bg-fd-muted px-1.5 py-0.5 font-mono text-sm">AppModule</code> and
            the codegen starts with your dev server — the typed client regenerates as you edit your
            controllers. No config file, no extra process.
          </p>
          <p className="mt-4 text-fd-muted-foreground">
            Shipping? The same generator ships as a CLI — run{' '}
            <code className="rounded bg-fd-muted px-1.5 py-0.5 font-mono text-sm">
              nestjs-codegen codegen
            </code>{' '}
            in CI before you deploy so the committed client can never drift from your routes.
          </p>
          <Link
            href="/docs/getting-started"
            className="mt-6 inline-flex items-center gap-2 font-medium text-violet-500 transition-colors hover:text-violet-400"
          >
            Full setup guide
            <ArrowRight className="size-4" />
          </Link>
        </div>

        <div className="space-y-4">
          <CodePane
            title="app.module.ts"
            badge="auto-starts in dev"
            badgeCls="text-violet-400"
            lines={MODULE_LINES}
          />
          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl shadow-black/30 ring-1 ring-white/5">
            <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/70 px-4 py-2.5">
              <Terminal className="size-3.5 text-zinc-500" />
              <span className="font-mono text-xs text-zinc-500">terminal</span>
            </div>
            <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed">
              <code>
                {CI_LINES.map((line, lineIndex) => (
                  <div key={lineIndex} className="whitespace-pre">
                    {line.tokens.map((token, tokenIndex) => (
                      <span key={tokenIndex} className={token.cls ?? 'text-zinc-300'}>
                        {token.text}
                      </span>
                    ))}
                    {line.tokens.length === 0 ? ' ' : null}
                  </div>
                ))}
              </code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 pb-28">
      <div className="relative overflow-hidden rounded-2xl border border-fd-border bg-fd-card/60 px-6 py-14 text-center backdrop-blur">
        <div
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(ellipse 60% 100% at 50% 0%, rgb(139 92 246 / 0.14), transparent 70%)',
          }}
        />
        <span className="inline-flex items-center gap-2 font-mono text-xs text-violet-500">
          <Sparkles className="size-4" />
          <Braces className="size-4" />
          <ShieldCheck className="size-4" />
        </span>
        <h2 className="mx-auto mt-4 max-w-2xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Stop hand-writing your API client.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-fd-muted-foreground">
          Generate it from the controllers you already have — typed end to end, with the validation
          lib, fetcher, and query layer of your choice.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs"
            className="group inline-flex items-center gap-2 rounded-lg bg-violet-500 px-6 py-2.5 font-medium text-zinc-950 shadow-[0_0_24px_-6px] shadow-violet-500/50 transition-all hover:bg-violet-400 hover:shadow-violet-400/60"
          >
            Get started
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a
            href={GITHUB_URL}
            className="rounded-lg border border-fd-border bg-fd-background/40 px-6 py-2.5 font-medium transition-colors hover:bg-fd-accent"
          >
            Star on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}
