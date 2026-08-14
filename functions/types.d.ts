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

/**
 * D1, declared here for the same reason as PagesFunction above: the surface we
 * use is four methods wide, and pulling @cloudflare/workers-types for it would
 * drag in a second copy of the DOM lib that fights with Astro's globals.
 *
 * `bind` is the only way values should reach a statement. D1 has no string
 * escaping helper and never will, so a template-literal query is a SQL
 * injection, not a shortcut.
 */
interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { last_row_id?: number; changes?: number; duration?: number };
}

interface D1PreparedStatement {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = Record<string, unknown>>(column?: string) => Promise<T | null>;
  run: <T = Record<string, unknown>>() => Promise<D1Result<T>>;
  all: <T = Record<string, unknown>>() => Promise<D1Result<T>>;
}

interface D1Database {
  prepare: (query: string) => D1PreparedStatement;
  batch: <T = Record<string, unknown>>(
    statements: D1PreparedStatement[],
  ) => Promise<D1Result<T>[]>;
  exec: (query: string) => Promise<{ count: number; duration: number }>;
}
