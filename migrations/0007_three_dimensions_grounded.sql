-- Three dimensions, and every score bound to a quote from a frozen snapshot.
--
-- Two changes, made together because either alone leaves the table lying about
-- what it holds.
--
-- ── 1. Five dimensions become three ──
-- `traction` and `execution` are dropped. They were not underperforming, they
-- were measuring the wrong thing, and an audit of the only two rows on the
-- board showed it in the plainest possible way: both companies scored 2 on
-- execution, with near-identical reasons, because the dimension's anchors read
--
--     5 — real docs, API reference, changelog or status page
--     2 — marketing pages and a demo request
--
-- which is a test of go-to-market motion, not of execution. Every enterprise
-- sales-led vendor in adtech — most SSPs, most verification companies — is
-- capped at 2 by construction no matter what it has built. Traction failed the
-- other way: it read a wall of vendor-published testimonials as "eight named
-- customers with titles" and scored 5, laundering marketing copy into an
-- apparently independent number.
--
-- Zero variance across the sample is zero information. A three-dimension mean
-- has fewer buckets (13 rather than 21) and every one of them means something.
--
-- `durability` becomes `outlook`, and widens: durability asked only whether a
-- company survives, which is the pessimistic half of the question. Outlook
-- weighs the direction of the need and the size of the market alongside the
-- headwinds, so a tailwind can raise a score rather than merely fail to lower
-- one.
--
-- ── 2. Every score carries a verifiable quote ──
-- `reasons_json` held prose, and prose cannot be checked. `evidence_json` holds
-- {reason, quote, source_url} per dimension, and the quote is asserted to be a
-- literal span of the stored snapshot before the row is ever written. A
-- fabricated claim cannot survive a string match, which turns "do we trust the
-- model" into a question the code answers.
--
-- `input_hash` binds the row to the exact bytes it was graded from, held in
-- `snapshot`. A score whose inputs cannot be reproduced is not a measurement,
-- and this board is going to be asked to defend numbers about real companies.
--
-- Old rows are archived, not migrated: a five-dimension mean cannot be
-- reinterpreted as a three-dimension one, and the quotes never existed to
-- backfill. The board starts empty and re-grades.
CREATE TABLE IF NOT EXISTS ranking_v6 AS SELECT * FROM ranking;

DROP TABLE IF EXISTS ranking;

-- The frozen input. One row per distinct crawl, shared by every ranking that
-- was graded from it, so re-grading the same bytes costs no storage and a
-- re-grade is provably a re-grade rather than a re-read.
CREATE TABLE IF NOT EXISTS snapshot (
  hash       TEXT PRIMARY KEY,          -- sha256 of `pages`, lowercase hex
  domain     TEXT NOT NULL,
  pages      TEXT NOT NULL,             -- the exact text handed to the grader
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_snapshot_domain ON snapshot(domain);

CREATE TABLE ranking (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,

  -- The mean of the three, to one decimal.
  grade REAL NOT NULL CHECK (grade BETWEEN 1 AND 5),

  originality   INTEGER NOT NULL CHECK (originality   BETWEEN 1 AND 5),
  defensibility INTEGER NOT NULL CHECK (defensibility BETWEEN 1 AND 5),
  outlook       INTEGER NOT NULL CHECK (outlook       BETWEEN 1 AND 5),

  -- {dimension: {reason, quote, source_url}}. The quote was verified against
  -- snapshot.pages before this row was inserted; see verifyQuotes().
  evidence_json TEXT NOT NULL DEFAULT '{}',

  summary    TEXT NOT NULL,
  stack_json TEXT NOT NULL DEFAULT '[]',

  -- Reproducibility, stored per row rather than assumed globally. Together
  -- these three say exactly what produced this number: which bytes, which
  -- rubric, which model. Any of them changing makes a row incomparable to rows
  -- graded before it, and a board that cannot say so is quietly averaging
  -- measurements taken with different instruments.
  input_hash     TEXT NOT NULL REFERENCES snapshot(hash),
  rubric_version TEXT NOT NULL,
  model_used     TEXT NOT NULL,

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ranking_grade ON ranking(grade DESC);
CREATE INDEX IF NOT EXISTS idx_ranking_company ON ranking(company_id);
