-- Ranking outlives its HTTP response.
--
-- The endpoint used to do the whole pipeline inside one request and answer with
-- the result. Cloudflare's edge cuts a request at roughly 120 seconds, which is
-- not configurable from inside a Function: measured on this board, a run that
-- returned at 119s succeeded and a run that reached 125s was killed with a 524
-- and nothing written. Ezoic needs ~137s. So the ceiling was not a rare edge —
-- it was a coin flip on every slow company, and the failure mode was the worst
-- available one, because the panel had already been paid for.
--
-- The pipeline now runs in waitUntil(), which survives the response, and its
-- outcome lands here for the client to poll. This table is the ONLY durable
-- record that a run is in flight; without it a backgrounded pipeline would have
-- no way to report either success or failure.
CREATE TABLE IF NOT EXISTS rank_job (
  -- A random opaque id rather than an autoincrement: it is handed to the
  -- browser and used to fetch a result, so it must not be guessable or
  -- enumerable.
  id          TEXT PRIMARY KEY,
  domain      TEXT NOT NULL,

  -- running  — waitUntil is still working
  -- ranked   — finished, payload holds the full result
  -- failed   — finished, payload holds a failure() object
  -- refused  — finished, payload explains why it was not eligible
  status      TEXT NOT NULL DEFAULT 'running'
              CHECK (status IN ('running', 'ranked', 'failed', 'refused')),

  -- Whatever the pipeline would previously have returned as its response body,
  -- stored verbatim so the polling endpoint stays a thin read.
  payload     TEXT,

  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

-- The poller reads by id; the staleness sweep reads by status and age.
CREATE INDEX IF NOT EXISTS idx_rank_job_status ON rank_job (status, created_at);
