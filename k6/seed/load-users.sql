-- Seeds the accounts and reference data the k6 suite needs.
--
-- WHY a pool of accounts rather than one:
--   POST /api/auth/login applies RULES.loginPerAccount — 12 logins per email
--   per 15 minutes (src/lib/rateLimit.ts). Each k6 VU logs in once, so a run
--   with more than ~10 VUs per account starts failing at the login step and
--   measures nothing. Rule of thumb: PERF_USER_COUNT >= VUs / 10.
--
-- WHY a dedicated COE domain:
--   Authorization in this app is domain-scoped (src/lib/authz.ts) — a user's
--   visible inventory is whatever belongs to users in their COE. Putting the
--   load accounts in their own domain means the test drives a realistic
--   non-super_admin scope AND its rows stay separable from real dev data.
--
-- Password for every seeded account: LoadTest123!
-- (bcrypt cost 12, matching src/lib/passwords.ts. Override at run time with
--  PERF_USER_PASSWORD only if you also regenerate the hash below.)
--
-- Run:
--   psql "$DATABASE_URL" -v users=20 -f k6/seed/load-users.sql
--
-- NEVER run this against production. These are known-password accounts.

\set ON_ERROR_STOP on
\if :{?users} \else \set users 20 \endif

BEGIN;

-- Guard: refuse to seed known-password accounts into a database that is not
-- obviously a local/test one. Adjust the allowed names if your disposable
-- database is called something else.
DO $$
BEGIN
  IF current_database() NOT IN ('inventory', 'inventory_test', 'inventory_loadtest') THEN
    RAISE EXCEPTION
      'Refusing to seed load-test accounts into database "%". Expected inventory / inventory_test / inventory_loadtest.',
      current_database();
  END IF;
END $$;

-- A department WITH a code: student ID codes decode to a department code, and
-- POST /api/lending returns 422 UNKNOWN_DEPARTMENT when the code has no row.
--
-- The code must be two LETTERS. src/lib/studentIdCode.ts matches
-- /^([a-z]{3})(\d{2})([a-z]{2})(\d{3})$/, so a code containing a digit
-- ("K6" being the obvious thing to reach for here) produces IDs that fail to
-- decode at all and every lending request 400s.
INSERT INTO departments (department_name, code)
VALUES ('K6 Load Test Dept', 'KX')
ON CONFLICT (department_name) DO UPDATE SET code = EXCLUDED.code;

INSERT INTO coe_domains (domain_name, room_name)
VALUES ('K6 Load Test COE', 'K6 Load Test Room')
ON CONFLICT (domain_name) DO NOTHING;

INSERT INTO category (category_name)
VALUES ('K6 Load Test Category')
ON CONFLICT (category_name) DO NOTHING;

INSERT INTO users (email, password_hash, full_name, department_id, domain_id, role, is_active)
SELECT
  format('k6.load%s@loadtest.local', i),
  -- bcrypt('LoadTest123!', 12)
  '$2b$12$CvD5/9dchvFXdgSS61Yr6.9RJ1Uzn3ZZSB8gngO56QDjDBXhKP/DW',
  format('K6 Load User %s', i),
  (SELECT department_id FROM departments WHERE department_name = 'K6 Load Test Dept'),
  (SELECT domain_id FROM coe_domains WHERE domain_name = 'K6 Load Test COE'),
  'user',
  TRUE
FROM generate_series(0, (:users)::int - 1) AS i
ON CONFLICT (email) DO UPDATE
  SET is_active = TRUE,
      domain_id = EXCLUDED.domain_id,
      department_id = EXCLUDED.department_id;

COMMIT;

SELECT count(*) AS k6_accounts FROM users WHERE email LIKE 'k6.load%@loadtest.local';
