-- Deactivates (does not delete) the seeded k6 accounts.
--
-- Deactivation rather than deletion is deliberate: users.user_id is
-- referenced by products.user_id, purchase_invoice.user_id, sessions, and the
-- stock ledger. Deleting the accounts would either fail on those constraints
-- or orphan history. is_active = FALSE is enough — src/lib/authz.ts
-- re-reads is_active from the database on every request, so the accounts stop
-- working immediately, including any session already holding a valid token.
--
--   psql "$DATABASE_URL" -f k6/seed/drop-users.sql

\set ON_ERROR_STOP on

BEGIN;

UPDATE users SET is_active = FALSE WHERE email LIKE 'k6.load%@loadtest.local';

-- Revoke their sessions too, so no refresh token stays live.
DELETE FROM sessions
WHERE user_id IN (SELECT user_id FROM users WHERE email LIKE 'k6.load%@loadtest.local');

COMMIT;

SELECT email, is_active FROM users WHERE email LIKE 'k6.load%@loadtest.local' ORDER BY email;
