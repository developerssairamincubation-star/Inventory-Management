-- Dedicated column for the scanned/typed student ID code
-- ([3-letter college][2-digit join year][2-letter dept][3-digit serial],
-- e.g. "sit21cs025" — see src/lib/studentIdCode.ts). Kept separate from the
-- legacy free-text student_number rather than repurposing it, since the two
-- have different formats/semantics and student_number has existing callers
-- (uniqueness check, search) that shouldn't change behavior.

ALTER TABLE students ADD COLUMN student_id_code VARCHAR(10);
CREATE UNIQUE INDEX uq_students_id_code ON students(student_id_code) WHERE student_id_code IS NOT NULL;
