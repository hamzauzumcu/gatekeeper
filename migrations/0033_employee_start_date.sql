-- Employment start date — the fixed fact every leave entitlement is derived from.
--
-- Annual leave accrues with seniority, so a balance means nothing without the
-- day the employee joined. Stored as a plain YYYY-MM-DD string, like every other
-- date in this schema; NULL means "unknown", and such an employee falls back to
-- the default annual quota (see shared/entitlement.ts).
--
-- The entitlement itself is NOT stored: it is recomputed from this date on every
-- read, so correcting a start date immediately corrects every year's balance.
ALTER TABLE employees ADD COLUMN start_date TEXT;
