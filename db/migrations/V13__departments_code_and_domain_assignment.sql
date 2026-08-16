-- Two additive changes for the coe-inventory rework:
--
-- 1. departments.code — a 2-letter admin-managed code used by the
--    student-ID decoder (src/lib/studentIdCode.ts) to resolve which
--    department a scanned ID belongs to. Nullable for now: existing
--    departments need an admin to backfill a code via Admin Settings before
--    their students can be decoded/added.
--
-- 2. users.domain_id / lending_order.domain_id — which COE domain a user
--    belongs to, and which COE domain a lending entry was issued under.
--    users.domain_id is NULL for super_admin (not tied to one domain) and
--    for any 'user' not yet assigned. lending_order.domain_id is always set
--    at creation time going forward (auto from the issuing COE user, or
--    manually picked when a super_admin without a domain issues one) — see
--    the lending POST rewrite. ON DELETE RESTRICT: a domain with lending
--    history can't be deleted out from under it.

ALTER TABLE departments ADD COLUMN code VARCHAR(2);
CREATE UNIQUE INDEX uq_departments_code ON departments(code) WHERE code IS NOT NULL;

ALTER TABLE users ADD COLUMN domain_id UUID REFERENCES coe_domains(domain_id) ON DELETE SET NULL;
CREATE INDEX idx_users_domain ON users(domain_id);

ALTER TABLE lending_order ADD COLUMN domain_id UUID REFERENCES coe_domains(domain_id) ON DELETE RESTRICT;
CREATE INDEX idx_lending_order_domain ON lending_order(domain_id);
