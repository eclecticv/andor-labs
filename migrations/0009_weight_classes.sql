-- Weight classes from headcount, and a founding year that finally gets written.
--
-- ── What was broken ──
-- `division` has been NOT NULL since migration 0001 with a CHECK constraint of
-- featherweight/middleweight/heavyweight, and every row ever written has said
-- "middleweight" — the API hardcodes it. `founded_year` has existed just as long
-- and has never been written at all. Two columns designed in, neither wired.
--
-- Meanwhile the board's actual stage axis, `band`, is derived from funding, and
-- funding is not on these websites: a round appears in crawlable markup on 7% of
-- them and jurors recall one about 0% of the time. So `place()` kept falling
-- through to "middle band by default" — every company classified identically by
-- a field that classified nothing.
--
-- ── What replaces it ──
-- Headcount and age, both of which a search returns for every company at high
-- confidence. Two axes that always resolve beat one that almost never does, and
-- they make a filter grid a reader can actually use: size against age.
--
-- `lightweight` replaces `featherweight` because that is the word in use.
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt — which is
-- also the moment to stop pretending the old value meant anything.
CREATE TABLE company_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  domain       TEXT    NOT NULL UNIQUE,
  name         TEXT    NOT NULL,
  slug         TEXT    NOT NULL UNIQUE,
  logo_url     TEXT,
  one_liner    TEXT,

  -- Year the company was founded, from third-party search. NULL when unknown,
  -- which is honest — the page shows an age only when there is one.
  founded_year INTEGER,

  -- Weight class, from headcount. NULL when the lookup found no size, rather
  -- than defaulting to the middle and quietly asserting something.
  division     TEXT CHECK (division IN ('lightweight', 'middleweight', 'heavyweight')),

  -- Headcount band as reported, kept alongside the class it produced so a
  -- reader can see the input as well as the bucket.
  headcount    TEXT,

  provisional  INTEGER NOT NULL DEFAULT 0,
  status       TEXT    NOT NULL DEFAULT 'published',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  category     TEXT,
  stage        TEXT,
  band         TEXT,
  side         TEXT,
  band_evidence TEXT,
  band_inferred INTEGER NOT NULL DEFAULT 0
);

INSERT INTO company_new (
  id, domain, name, slug, logo_url, one_liner, founded_year, division, headcount,
  provisional, status, created_at, category, stage, band, side, band_evidence, band_inferred
)
SELECT
  id, domain, name, slug, logo_url, one_liner, founded_year,
  -- Every existing row says "middleweight" because it was hardcoded, so it
  -- carries no information. NULL is the truthful value until a lookup runs.
  NULL, NULL,
  provisional, status, created_at, category, stage, band, side, band_evidence, band_inferred
FROM company;

DROP TABLE company;
ALTER TABLE company_new RENAME TO company;

CREATE INDEX IF NOT EXISTS idx_company_category ON company (category, status);
CREATE INDEX IF NOT EXISTS idx_company_cohort   ON company (band, side, status);
-- The new filter axes get their own index: the board is read by weight class
-- and by age, and both are `WHERE` clauses on every leaderboard view.
CREATE INDEX IF NOT EXISTS idx_company_division ON company (division, status);
CREATE INDEX IF NOT EXISTS idx_company_founded  ON company (founded_year);
