import './global.css';
import { RootProvider } from 'fumadocs-ui/provider';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: {
    default: 'nestjs-codegen',
    template: '%s — nestjs-codegen',
  },
  description:
    'Codegen for NestJS — typed routes, a typed API client, and validation schemas. Pluggable validation (zod/valibot/arktype), optional TanStack Query, bring-your-own fetcher, and nestjs-inertia + nestjs-filter integrations.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider theme={{ defaultTheme: 'dark' }}>{children}</RootProvider>
      </body>
    </html>
  );
}
