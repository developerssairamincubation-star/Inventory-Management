-- The coe-inventory lending flow creates a student record on first scan
-- with only the decoded ID (department, year, college) — a name is
-- optional and typed in later if given. The old manual "add student" form
-- always required a name, hence the original NOT NULL; that's no longer
-- true once scanning is the primary creation path.
ALTER TABLE students ALTER COLUMN name DROP NOT NULL;
