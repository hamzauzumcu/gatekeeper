-- Interview scorecard criteria, defined per position (optional).
--
-- Digitizes the paper "hiring scorecard": a position can define a set of
-- weighted evaluation criteria (hard/soft skills, weights summing to 100).
-- After each interview, interviewers will rate each criterion 1-5 or N/A;
-- all valid scores are aggregated only at the offer decision stage.
--
-- This table stores only the template. Interviewer scores land in a later
-- migration and will reference scorecard_criteria(id) — criteria are
-- first-class rows (not a JSON blob) so a renamed criterion keeps its scores.
--
-- archived_at: once interviewer scores exist for a criterion it must not be
-- hard-deleted (its scores would dangle). Removing such a criterion from the
-- editor sets archived_at instead; reads filter on it. Until the scoring flow
-- ships, removals are plain DELETEs (see worker/scorecards.ts).

CREATE TABLE scorecard_criteria (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id INTEGER NOT NULL REFERENCES job_positions(id) ON DELETE CASCADE,
  category    TEXT    NOT NULL CHECK (category IN ('hard','soft')),
  name        TEXT    NOT NULL,
  description TEXT,                                -- "what it means" helper shown to interviewers
  weight      INTEGER NOT NULL CHECK (weight BETWEEN 1 AND 100),  -- percent
  sort_order  INTEGER NOT NULL DEFAULT 0,          -- position within its category group
  archived_at TEXT,                                -- NULL = active
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_scorecard_criteria_position ON scorecard_criteria(position_id, archived_at);
