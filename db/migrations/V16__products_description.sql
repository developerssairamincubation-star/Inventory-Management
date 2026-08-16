-- Optional free-text product description, requested for the coe-inventory
-- product forms. No length constraint at the DB level; the app enforces a
-- soft cap.

ALTER TABLE products ADD COLUMN description TEXT;
