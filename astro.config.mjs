// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sanity from '@sanity/astro';
import sitemap from '@astrojs/sitemap';
import { loadEnv } from 'vite';

/**
 * Dev-only draft preview.
 *
 * The site is a static build, so `getStaticPaths` is the only thing that ever
 * queries Sanity — and a token-less client can only see published documents.
 * Handing the client a Viewer token plus `perspective: 'drafts'` is what makes
 * an unpublished post render at its real URL during `npm run dev`.
 *
 * The gate is not cosmetic. `sanity:client` is a module the Studio bundle also
 * imports, and the integration inlines this config verbatim into it — so a
 * token present during `astro build` would be baked into browser JavaScript and
 * shipped. `build` is matched on argv rather than NODE_ENV alone because argv
 * is set by the command the operator actually typed.
 *
 * Token lives in `.env` (gitignored). Absent, dev behaves exactly as before.
 */
const isBuild = process.argv.includes('build') || process.env.NODE_ENV === 'production';
const previewToken = isBuild
  ? undefined
  : loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '').SANITY_PREVIEW_TOKEN;

// https://astro.build/config
export default defineConfig({
  site: 'https://andorlabs.ca',
  // Allow public tunnel hosts (cloudflared/localtunnel) for phone preview on any network.
  vite: {
    // `agentation` is only ever imported by a `client:only="react"` island
    // (Agentation.tsx via Base.astro). Vite cannot crawl client:only imports at
    // startup, so it discovers this dep lazily and re-optimises mid-session —
    // which leaves the already-issued module URL returning
    // "504 Outdated Optimize Dep". The island then never mounts and the
    // annotation pill silently does not appear, with nothing obviously broken
    // on the page. Naming it here makes the pre-bundle deterministic.
    optimizeDeps: {
      include: ['agentation'],
    },
    server: {
      allowedHosts: ['.trycloudflare.com', '.loca.lt'],
      // Cloudflare Pages Functions (functions/api/*) do not run under `astro
      // dev` — only under `wrangler pages dev`, which serves the PRODUCTION
      // build and therefore strips the dev-only Agentation and CopyDiffer
      // islands in Base.astro. Previewing a page that calls an API used to mean
      // choosing between working endpoints and working annotation tools.
      //
      // This forwards /api/* to a wrangler instance so you get both:
      //   terminal 1:  npx wrangler pages dev dist --port 8788
      //   terminal 2:  portless andor npm run dev
      // Dev-only — `astro build` never reads vite.server.
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8788',
          // The Function's origin check accepts localhost origins (see
          // isLocalOrigin there), so the header passes through unmodified.
        },
      },
    },
  },
  integrations: [
    sanity({
      projectId: '2b9cfqwh',
      dataset: 'production',
      useCdn: false, // static build — always fresh content
      // Dev only — see `previewToken` above. Never present in a production build.
      ...(previewToken ? { token: previewToken, perspective: 'drafts' } : {}),
      studioBasePath: '/admin',
      studioRouterHistory: 'hash',
    }),
    // React powers the embedded Studio and the dev-only Agentation island (see Base.astro).
    react(),
    // /lab/* are dev-only design comparison pages. In production they build to
    // a redirect stub, so listing them in the sitemap submits redirects to
    // Google. Excluded alongside /admin.
    //
    // /tools/ joined them on 2026-08-21. It still resolves for anyone holding
    // the link, but it lists nothing while Rank My AdTech is WIP, and
    // submitting an empty index to Google is asking to be judged on it. Drop
    // this clause when a tool ships there again — docs/WIP-rank-my-adtech.md.
    sitemap({
      filter: (page) =>
        !page.includes('/admin') && !page.includes('/lab/') && !page.includes('/tools/'),
    }),
  ],
});
