import { type ComponentType, createElement } from 'react';
import { docs } from '@/.source';
import { loader } from 'fumadocs-core/source';
import * as lucide from 'lucide-react';

const lucideExports = lucide as unknown as Record<string, ComponentType | undefined>;

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
  // Resolve the `icon` field in meta.json / frontmatter to a lucide icon so the
  // docs sidebar renders per-page glyphs.
  icon(icon) {
    if (!icon) return;
    const Icon = lucideExports[icon];
    if (Icon) return createElement(Icon);
  },
});
