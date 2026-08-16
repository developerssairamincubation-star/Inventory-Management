-- Removes staff-as-borrower and mentor/project tracking entirely — the
-- coe-inventory lending rewrite (V15/V5 phase) has stopped writing these
-- since the lending route rewrite; this drops what's left behind.
--
-- NOTE for whoever runs this against real data: if any borrower_type='STAFF'
-- rows exist in a database this migration runs against, they will violate
-- the new CHECK constraint below — audit for that before migrating a
-- non-fresh database. A fresh local/dev DB from this branch won't have any.
ALTER TABLE lending_order DROP CONSTRAINT IF EXISTS chk_lending_borrower_one;
ALTER TABLE lending_order DROP COLUMN IF EXISTS project_name;
ALTER TABLE lending_order DROP COLUMN IF EXISTS mentor_staff_id;
ALTER TABLE lending_order DROP COLUMN IF EXISTS borrower_staff_id;
DROP TABLE IF EXISTS staffs;

-- borrower_type_enum keeps its unused 'STAFF' value (Postgres can't cheaply
-- drop an enum value); this CHECK is what actually enforces student-only.
ALTER TABLE lending_order
  ADD CONSTRAINT chk_lending_borrower_student_only
  CHECK (borrower_type = 'STUDENT' AND borrower_student_id IS NOT NULL);
