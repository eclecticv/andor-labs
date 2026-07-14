// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sanity from '@sanity/astro';

// https://astro.build/config
export default defineConfig({
  site: 'https://andorlabs.ca',
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
  ],
});
