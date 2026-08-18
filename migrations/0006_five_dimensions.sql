-- One model, five dimensions, one grade.
--
-- Replaces the panel (0005). The old columns (innovation / difficulty /
-- investability, 0-10 each, each the mean of three jurors) recorded what three
-- models thought; the new ones record what one model graded against a published
-- rubric. There is no arithmetic between the two — a 0-30 sum of three means
-- cannot be reinterpreted as five 1-5 grades — so old rows are archived rather
-- than migrated, and the board starts empty.
--
-- ── This migration archives before it drops ──
-- 0004 dropped `ranking` outright and cost six rows that could not be brought
-- back without Time Travel. 0005 fixed that by archiving first, and so does
-- this. Neither archive table is ever read by the site; they exist so the
-- decision to discard these scores stays reversible for as long as anyone
-- wants it. Drop them by hand when you are sure.
--
-- NOTE the table name: it is `panel_take`, not `juror_take`. 0001 created
-- `juror_take`, 0004 rebuilt it, and 0005 dropped it and created `panel_take`
-- in its place. `juror_take` does not exist in this database, and archiving it
-- here would abort the migration on its second statement.
CREATE TABLE IF NOT EXISTS ranking_v3    AS SELECT * FROM ranking;
CREATE TABLE IF NOT EXISTS panel_take_v3 AS SELECT * FROM panel_take;

-- The panel is gone. One grader does not have a seat, it has a byline, and a
-- byline is a column on the ranking rather than a table of its own.
DROP TABLE IF EXISTS panel_take;
DROP TABLE IF EXISTS ranking;

CREATE TABLE ranking (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,

  -- The headline: the mean of the five dimensions, to one decimal.
  --
  -- REAL rather than INTEGER, and it matters more here than it did at 0-30.
  -- Five integers in 1-5 average to 21 distinct values in 0.2 steps; rounding
  -- to whole numbers would collapse those 21 buckets into 5 and put most of
  -- the board in a three-way tie. The decimal IS the discrimination.
  grade REAL NOT NULL CHECK (grade BETWEEN 1 AND 5),

  -- The five, each an anchored integer. INTEGER and a CHECK rather than REAL,
  -- because there is no averaging left to do: one model picks one band per
  -- dimension, and a 3.5 here would mean the model invented a scale of its own.
  originality   INTEGER NOT NULL CHECK (originality   BETWEEN 1 AND 5),
  defensibility INTEGER NOT NULL CHECK (defensibility BETWEEN 1 AND 5),
  traction      INTEGER NOT NULL CHECK (traction      BETWEEN 1 AND 5),
  execution     INTEGER NOT NULL CHECK (execution     BETWEEN 1 AND 5),
  durability    INTEGER NOT NULL CHECK (durability    BETWEEN 1 AND 5),

  -- One line per dimension saying what on the pages produced that band.
  -- JSON object keyed by dimension. This is what makes a grade auditable: a
  -- number with no pointer to evidence is indistinguishable from a guess.
  reasons_json TEXT NOT NULL DEFAULT '{}',

  -- Three reasons the company is weaker than it looks, written BEFORE any
  -- score existed.
  --
  -- The panel generated this and threw it away. It is persisted now because
  -- with one grader there is no disagreement spread to publish, and this is
  -- the honest replacement: proof the grade was argued rather than felt.
  case_against_json TEXT NOT NULL DEFAULT '[]',

  -- The verdict paragraph. Same call as the grades — there is no separate
  -- writer any more, because five grades from one model need no synthesis.
  summary    TEXT NOT NULL,
  stack_json TEXT NOT NULL DEFAULT '[]',

  -- Which model graded this row, recorded per row rather than assumed.
  --
  -- The grader is PINNED with no fallback ladder, so in principle every row
  -- carries the same value. It is stored anyway: the day that pin changes,
  -- this column is the only thing that can tell a reader which rows are
  -- comparable to which. Pinning is a decision; this is the evidence of it.
  model_used TEXT NOT NULL,

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The board reads in grade order and nothing else, so this is the only index
-- the page needs. Descending, because a leaderboard is read from the top.
CREATE INDEX IF NOT EXISTS idx_ranking_grade ON ranking (grade DESC);
CREATE INDEX IF NOT EXISTS idx_ranking_company ON ranking (company_id);
