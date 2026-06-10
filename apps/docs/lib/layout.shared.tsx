import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

const GITHUB_URL = 'https://github.com/DavideCarvalho/nestjs-codegen';

/** Mono "status pill" wordmark: a live dot followed by the package name. */
function NavTitle() {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[15px] font-semibold tracking-tight">
      <span
        aria-hidden
        className="size-2 rounded-full bg-[#e0234e] shadow-[0_0_8px_2px] shadow-[#e0234e]/50"
      />
      nestjs-codegen
    </span>
  );
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: <NavTitle /> },
    links: [{ text: 'Documentation', url: '/docs', active: 'nested-url' }],
    githubUrl: GITHUB_URL,
  };
}
