// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  site: 'https://andorlabs.ca',
  // React powers the dev-only Agentation feedback island (see Base.astro).
  integrations: [react()],
});
