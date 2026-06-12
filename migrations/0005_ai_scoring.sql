-- AI scoring per position.
-- scoring_prompts    : per-position scoring prompt (upsert on position_id)
-- ai_score           : 0-100 integer; NULL = not scored yet
-- ai_score_reasoning : short explanation from the AI
-- ai_score_version   : 0 = unscored / pending; 1+ = scored with that schema version

CREATE TABLE scoring_prompts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id INTEGER NOT NULL UNIQUE REFERENCES job_positions(id) ON DELETE CASCADE,
  prompt      TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE applications ADD COLUMN ai_score           INTEGER;
ALTER TABLE applications ADD COLUMN ai_score_reasoning TEXT;
ALTER TABLE applications ADD COLUMN ai_score_version   INTEGER NOT NULL DEFAULT 0;
