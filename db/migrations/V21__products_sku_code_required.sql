-- Every product now gets sku_code auto-generated at creation (see
-- allocateNextSkuCode in src/lib/idSequences.ts, wired into
-- src/app/api/products/route.ts POST) — this is the barcode payload
-- printed on product labels and looked up by lending's scan-to-fetch.
-- Existing rows already have a value here (the column carries over
-- whatever was in the old manually-typed serial_number field, renamed in
-- V18) — this migration just enforces going forward what's already true
-- today. If this ever runs against a database with NULL or duplicate
-- sku_code values, it will fail loudly rather than silently corrupting
-- data; backfill those rows first in that case.

ALTER TABLE products ALTER COLUMN sku_code SET NOT NULL;
CREATE UNIQUE INDEX uq_products_sku_code ON products(sku_code);
