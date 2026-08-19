-- The panel returns, and "would you invest" does not.
--
-- 0006 replaced three jurors with one grader; 0007 cut that grader to three
-- quote-verified dimensions. Both are reverted in code, so this brings the
-- database back to the shape `panel.ts` and `writer.ts` read — the 0005 shape,
-- with one deliberate difference.
--
-- ── The one difference: investability becomes outlook ──
-- The third question used to be "Would you invest in this?", and it was
-- measuring the wrong thing. It asked a model to imagine a transaction, so
-- anything that made the transaction impossible — already acquired,
-- bootstrapped and not raising, too mature to have a round open — read as a
-- defect in the COMPANY. It was a liquidity question wearing a quality
-- question's clothes, and it systematically punished the companies on this
-- board with the best outcomes.
--
-- `outlook` asks where the company sits in three years: the direction of the
-- need it serves, the size of the market it can address, and whether it is in a
-- tailwind or a headwind. Same 0-10 scale, same anchoring discipline, and a
-- tailwind can now RAISE a score rather than merely fail to lower it.
--
-- ── Archive before dropping, as every migration here does ──
-- 0004 dropped `ranking` outright and cost six rows that could not be brought
-- back without Time Travel. Every migration since has archived first. The
-- three-dimension rows and their frozen snapshots go to `_v7` tables and are
-- never read again by the site; they exist so this decision stays reversible.
--
-- The board starts EMPTY. The 28 panel-era rankings in `ranking_v3` are not
-- restored: they were scored on investability, so their totals are not
-- comparable to anything graded after this, and a board that silently mixes two
-- rubrics is a board whose ranks mean nothing. `company` rows are left in
-- place — the board joins `ranking`, so a company without one is invisible, and
-- the ranking pipeline already clears rankless company rows before re-inserting.
CREATE TABLE IF NOT EXISTS ranking_v7  AS SELECT * FROM ranking;
CREATE TABLE IF NOT EXISTS snapshot_v7 AS SELECT * FROM snapshot;

DROP TABLE IF EXISTS ranking;
DROP TABLE IF EXISTS snapshot;

CREATE TABLE ranking (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,

  -- Sum of the three per-question means, 0-30, stored to one decimal.
  --
  -- REAL, not INTEGER, and that is the point: nine anchored integers averaged
  -- three ways produce values like 18.3, and rounding them to whole numbers
  -- would throw away exactly the granularity that stops the board tying.
  total       REAL NOT NULL CHECK (total       BETWEEN 0 AND 30),
  innovation  REAL NOT NULL CHECK (innovation  BETWEEN 0 AND 10),
  difficulty  REAL NOT NULL CHECK (difficulty  BETWEEN 0 AND 10),
  outlook     REAL NOT NULL CHECK (outlook     BETWEEN 0 AND 10),

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
-- "where do NVIDIA and Google disagree most" are questions this board should be
-- able to answer without parsing JSON in the client.
CREATE TABLE panel_take (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ranking_id INTEGER NOT NULL REFERENCES ranking(id) ON DELETE CASCADE,

  panelist_id TEXT NOT NULL,
  -- What actually answered. Differs from the panelist's declared model when the
  -- ladder fell to a lower rung, and the page says so when it does — the bios
  -- name a specific architecture and an unreported fallback would make them lie.
  model_used  TEXT NOT NULL,

  innovation INTEGER NOT NULL CHECK (innovation BETWEEN 0 AND 10),
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 0 AND 10),
  outlook    INTEGER NOT NULL CHECK (outlook    BETWEEN 0 AND 10),

  -- The three summaries and three per-question adjectives, keyed by question.
  ratings_json TEXT NOT NULL DEFAULT '{}',
  -- This panelist's one word for the company overall. What a board row carries.
  adjective    TEXT NOT NULL DEFAULT ''
);

-- These sit on tables this migration just created, so a bare CREATE is safe:
-- the indexes went with the DROP.
CREATE INDEX idx_ranking_company ON ranking (company_id);
CREATE INDEX idx_ranking_total   ON ranking (total DESC);
CREATE INDEX idx_panel_ranking   ON panel_take (ranking_id);

-- These sit on `company`, which this migration does not replace, so they
-- survive from 0004/0005 and a bare CREATE would fail the whole file. D1
-- applies a migration atomically, so that failure rolls everything back.
CREATE INDEX IF NOT EXISTS idx_company_category ON company (category, status);
CREATE INDEX IF NOT EXISTS idx_company_cohort   ON company (band, side, status);
