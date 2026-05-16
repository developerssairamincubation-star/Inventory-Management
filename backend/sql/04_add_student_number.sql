-- Migration: Add student registration/roll number to students table
-- students table already has: name, department_id, email, phone_number

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS student_number TEXT;

-- Optional unique constraint (uncomment if registration numbers must be unique)
-- ALTER TABLE public.students ADD CONSTRAINT uq_student_number UNIQUE (student_number);
