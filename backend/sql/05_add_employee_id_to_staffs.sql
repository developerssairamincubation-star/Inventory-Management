-- Migration: Add employee ID to staffs table
-- staffs table already has: name, department_id, email, phone_number

ALTER TABLE public.staffs
  ADD COLUMN IF NOT EXISTS employee_id TEXT;
