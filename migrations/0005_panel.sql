-- The panel: nine ratings, three panelists, one writer.
--
-- Replaces the four-dimension scorer. The old columns (positioning / content /
-- gtm_stack / innovation, 25 each) measured how well a company markets itself;
-- the new ones measure what three independent models think of it. There is no
-- reinterpretation between the two, so old rows cannot be carried forward.
--
-- ── This migration archives before it drops ──
-- 0004 dropped `ranking` outright and cost six rows that could not be brought
-- back without Time Travel. Nothing here is worth that a second time, so every
-- existing ranking is copied into ranking_v2 first. That table is never read by
-- the site; it exists so the decision to discard the old scores stays reversible
-- for as long as anyone wants it. Drop it by hand when you are sure.
CREATE TABLE IF NOT EXISTS ranking_v2 AS SELECT * FROM ranking;

-- Band and side join category on the company. Both are derived deterministically
-- (side from category via a lookup, band from structural evidence in the markup)
-- so they are stored rather than recomputed at render — the board sorts on them.
ALTER TABLE company ADD COLUMN band TEXT;
ALTER TABLE company ADD COLUMN side TEXT;
-- Why the band was chosen, and whether it was evidenced or inferred. Shown on
-- the page: a guessed band that looks identical to an evidenced one is worse
-- than an admitted gap, and this is what lets the page tell them apart.
ALTER TABLE company ADD COLUMN band_evidence TEXT;
ALTER TABLE company ADD COLUMN band_inferred INTEGER NOT NULL DEFAULT 0;

DROP TABLE IF EXISTS juror_take;
DROP TABLE IF EXISTS ranking;

CREATE TABLE ranking (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,

  -- Sum of the three per-question means, 0-30, stored to one decimal.
  --
  -- REAL, not INTEGER, and that is the point: nine anchored integers averaged
  -- three ways produce values like 18.3, and rounding them to whole numbers
  -- would throw away exactly the granularity that stops the board tying. The
  -- brief asked for few ties; storing the decimal is most of how that happens.
  total          REAL NOT NULL CHECK (total          BETWEEN 0 AND 30),
  innovation     REAL NOT NULL CHECK (innovation     BETWEEN 0 AND 10),
  difficulty     REAL NOT NULL CHECK (difficulty     BETWEEN 0 AND 10),
  investability  REAL NOT NULL CHECK (investability  BETWEEN 0 AND 10),

  -- The widest disagreement on the panel, when there was one. Surfaced on the
  -- page rather than averaged away — three labs splitting is the most
  -- interesting thing a ranking can produce.
  split_question TEXT,
  split_spread   INTEGER NOT NULL DEFAULT 0,

  -- The fourth model's paragraph. Never scores, only writes.
  summary    TEXT NOT NULL,
  stack_json TEXT NOT NULL DEFAULT '[]',

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per panelist per ranking: three rows, nine ratings.
--
-- A row per panelist rather than a JSON blob on `ranking`, because the panel is
-- queryable subject matter in its own right — "which model is the harshest",
-- "where do NVIDIA and DeepSeek disagree most" are questions this board should
-- be able to answer without parsing JSON in the client.
CREATE TABLE panel_take (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ranking_id   INTEGER NOT NULL REFERENCES ranking(id) ON DELETE CASCADE,

  panelist_id  TEXT    NOT NULL,
  -- What actually answered. Differs from the panelist's declared model when the
  -- ladder fell to a lower rung, and the page says so when it does — the bios
  -- name a specific architecture and an unreported fallback would make them lie.
  model_used   TEXT    NOT NULL,

  innovation    INTEGER NOT NULL CHECK (innovation    BETWEEN 0 AND 10),
  difficulty    INTEGER NOT NULL CHECK (difficulty    BETWEEN 0 AND 10),
  investability INTEGER NOT NULL CHECK (investability BETWEEN 0 AND 10),

  -- The three summaries and three per-question adjectives, keyed by question.
  ratings_json TEXT NOT NULL DEFAULT '{}',
  -- This panelist's one word for the company overall. What a board row carries.
  adjective    TEXT NOT NULL DEFAULT ''
);

-- These three sit on tables this migration just created, so a bare CREATE is
-- safe: the indexes went with the DROP.
CREATE INDEX idx_ranking_company ON ranking (company_id);
CREATE INDEX idx_ranking_total   ON ranking (total DESC);
CREATE INDEX idx_panel_ranking   ON panel_take (ranking_id);

-- These sit on `company`, which this migration ALTERs rather than replaces —
-- so idx_company_category survives from 0004 and a bare CREATE fails the whole
-- migration. D1 applies a migration atomically, so that failure rolls the
-- entire file back, which is how this was caught rather than half-applied.
CREATE INDEX IF NOT EXISTS idx_company_category ON company (category, status);
-- The board's primary access path: tabs are bands, sections are sides.
CREATE INDEX IF NOT EXISTS idx_company_cohort   ON company (band, side, status);
