// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sanity from '@sanity/astro';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://andorlabs.ca',
  // Allow public tunnel hosts (cloudflared/localtunnel) for phone preview on any network.
  vite: {
    server: {
      allowedHosts: ['.trycloudflare.com', '.loca.lt'],
    },
  },
  integrations: [
    sanity({
      projectId: '2b9cfqwh',
      dataset: 'production',
      useCdn: false, // static build — always fresh content
      studioBasePath: '/admin',
      studioRouterHistory: 'hash',
    }),
    // React powers the embedded Studio and the dev-only Agentation island (see Base.astro).
    react(),
    // /lab/* are dev-only design comparison pages. In production they build to
    // a redirect stub, so listing them in the sitemap submits redirects to
    // Google. Excluded alongside /admin.
    sitemap({ filter: (page) => !page.includes('/admin') && !page.includes('/lab/') }),
  ],
});
