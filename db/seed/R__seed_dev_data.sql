-- Flyway "repeatable" migration: dev/local seed data only.
-- Re-run freely in local/dev environments (flyway migrate re-applies R__
-- scripts whenever their checksum changes). Never point this at a
-- prod-labeled Flyway invocation/environment.
--
-- Default super_admin login for local dev:
--   email:    admin@inventory.local
--   password: ChangeMe123!   (bcrypt hash below, cost factor 12)
-- Change this password after first login in any shared/long-lived environment.

INSERT INTO departments (department_name)
VALUES ('General')
ON CONFLICT (department_name) DO NOTHING;

INSERT INTO users (email, password_hash, full_name, department_id, role, is_active)
SELECT
  'admin@inventory.local',
  '$2b$12$0QKt/g4ZbThY382SeiOgsuz7SaKEXCVXas6P43RO4SUyJ5IczVmaK',
  'Dev Super Admin',
  d.department_id,
  'super_admin',
  TRUE
FROM departments d
WHERE d.department_name = 'General'
ON CONFLICT (email) DO NOTHING;

INSERT INTO category (category_name)
VALUES ('General Equipment')
ON CONFLICT (category_name) DO NOTHING;
