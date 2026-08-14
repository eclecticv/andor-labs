-- Jurors say more than one line.
--
-- The original shape stored a single `quote` per juror, which made the panel
-- section on a company page read as three soundbites — entertaining, but it
-- gave a reader no way to check whether the score was reasoned or vibes. The
-- quote survives as the pull-line; `reasoning` is the argument behind it.
--
-- `keyword` is one word summarising that juror's take ("unimpressed", "curious",
-- "sold"). It exists so a leaderboard row can carry the panel's temperature
-- without carrying its prose: three keywords fit on a row, three quotes do not.
ALTER TABLE juror_take ADD COLUMN reasoning TEXT;
ALTER TABLE juror_take ADD COLUMN keyword TEXT;
