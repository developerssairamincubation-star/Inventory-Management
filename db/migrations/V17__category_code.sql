-- 3-4 letter category code, source of the auto-generated product SKU prefix
-- (e.g. "Arduino Boards" -> ARD, "Resistors" -> RES — see
-- src/lib/idSequences.ts allocateNextSkuCode). Auto-suggested when a
-- category is created (categories are created ad hoc from the Products
-- page) but editable. Nullable for now: existing categories need a code
-- backfilled before products in them can get an auto SKU.

ALTER TABLE category ADD COLUMN code VARCHAR(4);
CREATE UNIQUE INDEX uq_category_code ON category(code) WHERE code IS NOT NULL;
