-- Interview scorecard submissions.
--
-- One scorecard per interviewer per application (editable after submit). Each
-- submission holds per-criterion scores 1-5; a criterion with no row means
-- "N/A / not observed" — only numeric scores are stored, which keeps the
-- offer-stage aggregation a plain AVG over rows (the paper scorecard's rule:
-- average only numeric scores, exclude N/A).
--
-- Also widens the candidate_events CHECK with scorecard events so submissions
-- show up in the candidate History tab. candidate_events has no child tables,
-- so the rebuild is a straight copy (same dance as 0010/0011/0021 minus the
-- answer stash).

CREATE TABLE interview_scorecards (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  interviewer    TEXT    NOT NULL,               -- users.username; display name resolved at read time
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (application_id, interviewer)
);

-- Scores reference scorecard_criteria by id so a renamed criterion keeps its
-- scores. Criteria with scores are never hard-deleted (the template editor
-- archives them instead — worker/scorecards.ts), so the CASCADE here only
-- fires when a whole application/scorecard is deleted.
CREATE TABLE interview_scorecard_scores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scorecard_id INTEGER NOT NULL REFERENCES interview_scorecards(id) ON DELETE CASCADE,
  criterion_id INTEGER NOT NULL REFERENCES scorecard_criteria(id) ON DELETE CASCADE,
  score        INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  UNIQUE (scorecard_id, criterion_id)
);

CREATE INDEX idx_scorecard_scores_criterion ON interview_scorecard_scores(criterion_id);

-- Widen candidate_events.event_type with scorecard_submitted / scorecard_updated.
PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE candidate_events_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id   INTEGER NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  event_type     TEXT    NOT NULL CHECK (event_type IN (
                   'fit_status_changed', 'pipeline_status_changed', 'note_added', 'note_deleted',
                   'scorecard_submitted', 'scorecard_updated'
                 )),
  from_value     TEXT,
  to_value       TEXT,
  application_id  INTEGER REFERENCES applications(id) ON DELETE SET NULL,
  metadata       TEXT,
  actor          TEXT    NOT NULL,
  actor_name     TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

INSERT INTO candidate_events_new (
  id, applicant_id, event_type, from_value, to_value, application_id, metadata, actor, actor_name, created_at
)
SELECT id, applicant_id, event_type, from_value, to_value, application_id, metadata, actor, actor_name, created_at
FROM candidate_events;

DROP TABLE candidate_events;
ALTER TABLE candidate_events_new RENAME TO candidate_events;

CREATE INDEX idx_events_applicant ON candidate_events(applicant_id, created_at);
