-- Gatekeeper — başvuru takip şeması
-- Tally CSV'leri bu 5 tabloya parse edilir.
-- D1 (SQLite). Çalıştır: wrangler d1 migrations apply gatekeeper

-- 1) İş ilanları. Yeni pozisyon = buraya bir satır.
CREATE TABLE job_positions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT    NOT NULL UNIQUE,           -- "apple-search-ads-campaign-manager"
  title       TEXT    NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,        -- boolean (0/1)
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 2) Pozisyona özel sorular. Hard-code yerine burada.
--    Parse ederken field_key ile CSV kolonuna eşlenir.
CREATE TABLE position_questions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id  INTEGER NOT NULL REFERENCES job_positions(id) ON DELETE CASCADE,
  field_key    TEXT    NOT NULL,                 -- CSV başlığıyla eşleşen anahtar
  label        TEXT    NOT NULL,                 -- "NestJS deneyimin kaç yıl?"
  type         TEXT    NOT NULL DEFAULT 'text'   -- text | number | boolean | file
              CHECK (type IN ('text','number','boolean','file')),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (position_id, field_key)
);

-- 3) Başvuru sahibi. Aynı kişi farklı pozisyona / tekrar başvurabilir.
CREATE TABLE applicants (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  respondent_id  TEXT    UNIQUE,                 -- Tally respondent ID
  full_name      TEXT,
  email          TEXT,
  phone          TEXT,                           -- varchar, normalize ETME
  country        TEXT,                           -- nullable (161 satırda boş)
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_applicants_email ON applicants(email);

-- 4) Tek bir başvuru.
CREATE TABLE applications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id  INTEGER NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  position_id   INTEGER NOT NULL REFERENCES job_positions(id) ON DELETE CASCADE,
  resume_url    TEXT,                            -- şimdilik Tally CDN; sonra R2
  cover_letter  TEXT,                            -- optional (~1746 boş)
  status        TEXT    NOT NULL DEFAULT 'new'
               CHECK (status IN ('new','reviewed','shortlisted','rejected')),
  submitted_at  TEXT,                            -- ISO-8601 UTC'ye parse edilir
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_applications_position ON applications(position_id);
CREATE INDEX idx_applications_applicant ON applications(applicant_id);
CREATE INDEX idx_applications_status   ON applications(status);

-- 5) Pozisyona özel soruların cevapları.
CREATE TABLE application_answers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id  INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  question_id     INTEGER NOT NULL REFERENCES position_questions(id) ON DELETE CASCADE,
  value           TEXT,                          -- ham değer; type'a göre yorumlanır
  UNIQUE (application_id, question_id)
);

CREATE INDEX idx_answers_application ON application_answers(application_id);
CREATE INDEX idx_answers_question    ON application_answers(question_id);
