-- Throttle state for the rebuild trigger.
--
-- The board is static, so a new ranking is only visible after a Pages build.
-- Firing the deploy hook on every submission would work but spends a build per
-- ranking, and Pages build quota is monthly and finite — a tool that goes even
-- mildly viral would exhaust it and take the whole site's deploys down with it.
--
-- One row, id = 1. `last_fired_at` is when the hook last actually fired;
-- `pending` records that a ranking has been written since then and is waiting
-- for the next fire.
--
-- Known edge: if a burst ends and no further submission arrives, the final
-- ranking waits for the next submission to carry it out. That is acceptable for
-- a leaderboard whose whole traffic model is submissions, and it is what a cron
-- trigger would close if this ever needs closing.
CREATE TABLE build_state (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  last_fired_at TEXT,
  pending       INTEGER NOT NULL DEFAULT 0 CHECK (pending IN (0, 1))
);

INSERT INTO build_state (id, last_fired_at, pending) VALUES (1, NULL, 0);
