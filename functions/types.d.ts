/**
 * Minimal ambient types for Cloudflare Pages Functions.
 *
 * tsconfig.json includes `**\/*`, so `functions/` is type-checked by
 * `astro check` even though Cloudflare — not Astro — compiles and runs it.
 * Pulling in the full `@cloudflare/workers-types` package for the one
 * `PagesFunction` signature we use would add a heavyweight dependency that
 * also redeclares half the DOM lib and conflicts with Astro's own globals.
 * The handler contract is small and stable, so it is declared here instead.
 */

interface EventContext<Env, P extends string = string, Data = Record<string, unknown>> {
  request: Request;
  env: Env;
  params: Record<P, string | string[]>;
  data: Data;
  waitUntil: (promise: Promise<unknown>) => void;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
}

type PagesFunction<
  Env = unknown,
  P extends string = string,
  Data = Record<string, unknown>,
> = (context: EventContext<Env, P, Data>) => Response | Promise<Response>;
