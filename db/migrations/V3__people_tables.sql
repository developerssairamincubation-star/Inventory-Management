-- Borrowers: students and staff.

CREATE TABLE students (
  student_id     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(200) NOT NULL,
  department_id  UUID         REFERENCES departments(department_id) ON DELETE SET NULL,
  email          VARCHAR(255) UNIQUE,
  phone_number   VARCHAR(30),
  student_number TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_students_department ON students(department_id);
CREATE INDEX idx_students_name       ON students(name);

CREATE TABLE staffs (
  staff_id      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(200) NOT NULL,
  department_id UUID         REFERENCES departments(department_id) ON DELETE SET NULL,
  email         VARCHAR(255) UNIQUE,
  phone_number  VARCHAR(30),
  employee_id   TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_staffs_department ON staffs(department_id);
CREATE INDEX idx_staffs_name       ON staffs(name);
