-- Score history: one row per AI scoring run, so past scores stay visible after a
-- prompt change re-scores an application and overwrites applications.ai_score.
-- scoring_prompt_history snapshots each saved prompt version; a history entry's
-- prompt_updated_at matches the snapshot's saved_at, linking score → prompt text.

CREATE TABLE IF NOT EXISTS scoring_prompt_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id INTEGER NOT NULL REFERENCES job_positions(id) ON DELETE CASCADE,
  prompt      TEXT NOT NULL,
  saved_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_history_position
  ON scoring_prompt_history(position_id, saved_at);

CREATE TABLE IF NOT EXISTS ai_score_history (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id    INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  score             INTEGER NOT NULL,
  reasoning         TEXT,
  score_version     INTEGER NOT NULL,
  prompt_updated_at TEXT,
  scored_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_score_history_application
  ON ai_score_history(application_id, scored_at);

-- Seed both tables from current data so history starts populated: the active
-- prompt of each position, and each application's current score.
INSERT INTO scoring_prompt_history (position_id, prompt, saved_at)
SELECT position_id, prompt, updated_at FROM scoring_prompts;

INSERT INTO ai_score_history (application_id, score, reasoning, score_version, prompt_updated_at, scored_at)
SELECT id, ai_score, ai_score_reasoning, ai_score_version, ai_scored_prompt_at, COALESCE(ai_scored_at, datetime('now'))
FROM applications
WHERE ai_score IS NOT NULL;
