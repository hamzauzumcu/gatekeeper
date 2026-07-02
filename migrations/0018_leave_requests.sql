-- Leave requests. Time-off filed through a Tally form (or bulk-loaded from a CSV
-- export); an admin maps each to an employee, then approves or rejects it.
--
-- We store the form fields RAW rather than normalizing, because the real data is
-- messy and inconsistent: durations arrive as either hours or working days, are
-- sometimes fractional ("1,5", "0.5") or free text ("1 buçuk saat"), and the two
-- date fields are occasionally entered out of order. Keeping the original strings
-- avoids lossy guesses — the UI presents them as-is.
--
-- submission_id is the Tally submission id, used to dedupe re-imports; it is
-- UNIQUE but nullable (SQLite allows multiple NULLs) so manually-added rows are
-- still permitted. reviewer/reviewer_name reference an app user (users.username).
CREATE TABLE leave_requests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id  TEXT    UNIQUE,                        -- Tally submission id (dedup key); NULL if manual
  respondent_id  TEXT,                                  -- Tally respondent id
  employee_id    INTEGER REFERENCES employees(id),      -- mapped employee (NULL until mapped)
  raw_name       TEXT    NOT NULL,                       -- name exactly as submitted
  leave_type     TEXT,                                  -- raw type: 'Annual Leave', 'Sick Leave', ...
  start_date     TEXT,                                  -- as submitted (usually YYYY-MM-DD)
  end_date       TEXT,                                  -- as submitted
  hours_requested TEXT,                                 -- raw: '5 hours', '1,5', ... (may be empty)
  working_days   TEXT,                                  -- raw: '3', '1,5', ... (may be empty)
  reason         TEXT,
  document_url   TEXT,                                  -- optional supporting document link
  submitted_at   TEXT,                                  -- form submission timestamp
  status         TEXT    NOT NULL DEFAULT 'pending',    -- pending | approved | rejected
  reviewer       TEXT,                                  -- app username who decided
  reviewer_name  TEXT,
  reviewed_at    TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Common views: list by status newest-first, and requests for one employee.
CREATE INDEX idx_leave_requests_status ON leave_requests (status, submitted_at);
CREATE INDEX idx_leave_requests_employee ON leave_requests (employee_id);
