-- Rank My AdTech — initial schema.
--
-- Four tables: the company, the ranking it received, what each juror said, and
-- the raw submission. Jurors are split into their own table rather than stored
-- as JSON on the ranking because the company page renders one block per juror
-- and the panel size is not fixed — a juror whose provider is down abstains, so
-- a ranking legitimately has two takes instead of three.

-- ── company ─────────────────────────────────────────────────────────────────
-- One row per company, permanently. `domain` is UNIQUE and that constraint is
-- load-bearing in two directions: it stops the board filling with duplicates,
-- and it is the cost control, because a resubmitted domain returns the existing
-- row instead of spending four model calls to say the same thing again.
CREATE TABLE company (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  domain       TEXT    NOT NULL UNIQUE,
  name         TEXT    NOT NULL,
  slug         TEXT    NOT NULL UNIQUE,
  logo_url     TEXT,
  one_liner    TEXT,
  founded_year INTEGER,

  -- Weight class. Companies rank within their division, because scoring a
  -- seed company against a public one on one table is the bias the whole
  -- design exists to avoid.
  division     TEXT    NOT NULL CHECK (division IN ('featherweight', 'middleweight', 'heavyweight')),

  -- Not a division — a flag. Set when the site is a waitlist page with no
  -- product detail, i.e. there is not enough public evidence to score
  -- honestly. The score still renders; the badge is what makes it honest.
  provisional  INTEGER NOT NULL DEFAULT 0 CHECK (provisional IN (0, 1)),

  -- Removal flips this rather than deleting, so the slug can return 410 rather
  -- than 404 and the history of what was published survives the takedown.
  status       TEXT    NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'removed')),

  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── ranking ─────────────────────────────────────────────────────────────────
-- Axis maximums are enforced here rather than only in application code. The
-- scores arrive from a language model, and a model that ignores its instructions
-- and returns 90 for a 40-point axis should fail loudly at the write rather than
-- quietly publish a 150/100 to a public leaderboard.
CREATE TABLE ranking (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,

  total           INTEGER NOT NULL CHECK (total           BETWEEN 0 AND 100),
  paradigm        INTEGER NOT NULL CHECK (paradigm        BETWEEN 0 AND 40),
  non_obviousness INTEGER NOT NULL CHECK (non_obviousness BETWEEN 0 AND 25),
  vibe_code       INTEGER NOT NULL CHECK (vibe_code       BETWEEN 0 AND 20),
  conviction      INTEGER NOT NULL CHECK (conviction      BETWEEN 0 AND 15),

  verdict         TEXT    NOT NULL,   -- the synthesizer's write-up
  split_note      TEXT,               -- where the panel disagreed, if it did
  platform_note   TEXT,               -- unscored: what is rented from a platform

  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── juror_take ──────────────────────────────────────────────────────────────
-- `abstained` records a juror whose provider failed. The panel fans out with
-- allSettled, so losing a juror must cost one opinion rather than the ranking;
-- storing the abstention is what lets the page say "two of three" honestly
-- instead of silently presenting a smaller panel as if it were the whole one.
CREATE TABLE juror_take (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ranking_id  INTEGER NOT NULL REFERENCES ranking(id) ON DELETE CASCADE,
  provider    TEXT    NOT NULL,   -- gemini | nvidia | opencode
  model_id    TEXT    NOT NULL,   -- pinned id actually called
  lens        TEXT    NOT NULL,   -- vc | engineer | lifer
  scores_json TEXT,               -- this juror's four axis scores, before averaging
  quote       TEXT,               -- the line worth pulling onto the page
  abstained   INTEGER NOT NULL DEFAULT 0 CHECK (abstained IN (0, 1))
);

-- ── submission ──────────────────────────────────────────────────────────────
-- The lead record and the rate-limit counter are the same table because they
-- are the same event. `ip_hash` is a hash rather than an address: rate limiting
-- needs to know two requests came from one origin, which does not require
-- storing where that origin is.
CREATE TABLE submission (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  domain     TEXT NOT NULL,
  ip_hash    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── indexes ─────────────────────────────────────────────────────────────────
-- The leaderboard query is "published companies in one division, best first",
-- which spans both tables, so both halves of it are indexed.
CREATE INDEX idx_company_division ON company (division, status);
CREATE INDEX idx_ranking_company   ON ranking (company_id);
CREATE INDEX idx_ranking_total     ON ranking (total DESC);
CREATE INDEX idx_juror_ranking     ON juror_take (ranking_id);

-- Rate limiting counts one origin's submissions within a window, so the index
-- leads with ip_hash and carries the timestamp to make the range scan cheap.
CREATE INDEX idx_submission_ip ON submission (ip_hash, created_at);
