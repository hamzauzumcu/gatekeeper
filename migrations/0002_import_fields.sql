-- CSV import için iki alan:
--   applicants.linkedin_url   — Tally "LinkedIN Profile" kolonu
--   applications.tally_submission_id — Tally "Submission ID"; import idempotency anahtarı
-- Aynı kişi (respondent_id) birden çok kez başvurabildiği için dedup submission_id üzerinden yapılır.

ALTER TABLE applicants ADD COLUMN linkedin_url TEXT;
ALTER TABLE applications ADD COLUMN tally_submission_id TEXT;

-- SQLite'ta birden çok NULL'a izin verir; sadece dolu submission_id'ler tekil olur.
CREATE UNIQUE INDEX idx_applications_submission ON applications(tally_submission_id);
