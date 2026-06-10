import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

// Static export is opt-in via env so default `next build`/dev are unchanged.
// The GitHub Pages workflow sets DOCS_STATIC_EXPORT=true to emit `out/`, and
// DOCS_BASE_PATH=/<repo> so assets resolve under the project Pages sub-path.
const staticExport = process.env.DOCS_STATIC_EXPORT === 'true';
const basePath = process.env.DOCS_BASE_PATH || '';

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  ...(staticExport
    ? { output: 'export', images: { unoptimized: true }, ...(basePath ? { basePath } : {}) }
    : {}),
};

export default withMDX(config);
