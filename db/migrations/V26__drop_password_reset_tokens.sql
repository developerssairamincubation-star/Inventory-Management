-- Self-service password reset (email-based) has been removed entirely —
-- forgotten passwords are now reset by a super_admin via Admin Settings.
-- Drops the now-unused table; src/lib/mailer.ts and the forgot-password/
-- reset-password routes were removed in the same change.

DROP TABLE IF EXISTS password_reset_tokens;
