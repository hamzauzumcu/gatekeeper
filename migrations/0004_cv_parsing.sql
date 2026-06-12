-- CV AI parsing sonuçları.
-- resume_text    : ham metin — sonraki AI sorgularında PDF'e gitmeden kullanılır
-- resume_parsed  : yapısal veri (JSON) — json_extract() ile sorgulanabilir
-- resume_parse_version : hangi schema versiyonuyla parse edildi; 0 = henüz parse edilmedi
--   PARSE_VERSION yükseltilince sync endpoint eksik olanları yeniden parse eder

ALTER TABLE applications ADD COLUMN resume_text          TEXT;
ALTER TABLE applications ADD COLUMN resume_parsed        TEXT;
ALTER TABLE applications ADD COLUMN resume_parse_version INTEGER NOT NULL DEFAULT 0;
