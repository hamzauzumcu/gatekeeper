-- Aday uygunluk durumu: recruiter tarafından atanır, birden fazla adaya toplu atanabilir.
ALTER TABLE applicants ADD COLUMN fit_status TEXT CHECK (fit_status IN ('not_fit', 'good_fit', 'maybe'));
CREATE INDEX idx_applicants_fit_status ON applicants(fit_status);
