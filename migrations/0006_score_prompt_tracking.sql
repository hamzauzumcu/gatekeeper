-- Self-verifying score freshness.
-- ai_scored_at        : when the score was last written (datetime('now')); NULL = never scored
-- ai_scored_prompt_at : the scoring prompt's updated_at at score time.
--                       An application is "pending" when this is NULL or older than the
--                       position's current scoring_prompts.updated_at, so a prompt change
--                       automatically re-queues affected candidates without a manual reset.

ALTER TABLE applications ADD COLUMN ai_scored_at        TEXT;
ALTER TABLE applications ADD COLUMN ai_scored_prompt_at TEXT;
