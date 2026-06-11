import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { librarySwitcher } from './libraries';

const GITHUB_URL = 'https://github.com/DavideCarvalho/nestjs-codegen';

/** Mono wordmark with the violet "wire" dot — the landing's identity, continued. */
function NavTitle() {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[15px] font-semibold tracking-tight">
      <span
        aria-hidden
        className="size-2 rounded-full bg-violet-400 shadow-[0_0_8px_2px] shadow-violet-500/50"
      />
      nestjs-codegen
    </span>
  );
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: <NavTitle /> },
    links: [
      { text: 'Documentation', url: '/docs', active: 'nested-url' },
      librarySwitcher('nestjs-codegen'),
    ],
    githubUrl: GITHUB_URL,
  };
}
