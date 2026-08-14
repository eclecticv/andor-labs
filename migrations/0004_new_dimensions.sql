-- The scorer's shape: four dimensions, a category, and a real stage.
--
-- The old ranking columns (paradigm / non_obviousness / vibe_code / conviction)
-- were the adtech-innovation axes and carried CHECK constraints tied to their
-- old maximums of 40/25/20/15. The new dimensions are 25 each and mean entirely
-- different things, so this is a replacement rather than a rename — a row
-- scored under the old axes cannot be reinterpreted under the new ones.
--
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt. Existing
-- rows are not migrated: they are invalid under the new rubric by definition.

-- Category and stage move onto the company. `division` stays for now so the
-- current board keeps rendering while the pages are switched over.
ALTER TABLE company ADD COLUMN category TEXT;
ALTER TABLE company ADD COLUMN stage TEXT;

DROP TABLE IF EXISTS juror_take;
DROP TABLE IF EXISTS ranking;

CREATE TABLE ranking (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,

  total       INTEGER NOT NULL CHECK (total       BETWEEN 0 AND 100),
  positioning INTEGER NOT NULL CHECK (positioning BETWEEN 0 AND 25),
  content     INTEGER NOT NULL CHECK (content     BETWEEN 0 AND 25),
  gtm_stack   INTEGER NOT NULL CHECK (gtm_stack   BETWEEN 0 AND 25),
  innovation  INTEGER NOT NULL CHECK (innovation  BETWEEN 0 AND 25),

  -- Reasoning and the improvement line for each dimension, as JSON. Scores are
  -- columns because the board sorts and benchmarks on them; prose is not, and
  -- twelve text columns to hold it would be a schema pretending to be queryable.
  detail_json TEXT NOT NULL DEFAULT '{}',

  verdict     TEXT NOT NULL,
  -- What the stack detector saw, so the page can show it without re-fetching.
  stack_json  TEXT NOT NULL DEFAULT '[]',

  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The panel is not gone, only unwired: the single-call scorer lands first and a
-- compact three-model panel can layer on top. This table keeps its shape ready.
CREATE TABLE juror_take (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ranking_id  INTEGER NOT NULL REFERENCES ranking(id) ON DELETE CASCADE,
  provider    TEXT    NOT NULL,
  model_id    TEXT    NOT NULL,
  scores_json TEXT,
  keyword     TEXT
);

CREATE INDEX idx_ranking_company  ON ranking (company_id);
CREATE INDEX idx_ranking_total    ON ranking (total DESC);
CREATE INDEX idx_juror_ranking    ON juror_take (ranking_id);
CREATE INDEX idx_company_category ON company (category, status);
CREATE INDEX idx_company_stage    ON company (stage, status);
