-- Image attachments for candidate notes.
-- Stored as a JSON array of public R2 URLs (NULL when a note has no images).
ALTER TABLE candidate_notes ADD COLUMN images TEXT;
