-- V21 made sku_code NOT NULL + UNIQUE, which is correct for real product
-- creation (src/app/api/products/route.ts POST always explicitly generates
-- and sets it via allocateNextSkuCode) — but it also broke every other
-- direct INSERT INTO products that doesn't care about SKUs (test fixtures,
-- one-off scripts). A DB-level default keeps those working without forcing
-- every caller to think about SKU generation; it's a random, harmless,
-- obviously-not-a-real-SKU placeholder that the real creation path always
-- overrides anyway.
ALTER TABLE products ALTER COLUMN sku_code SET DEFAULT ('TMP-' || substr(gen_random_uuid()::text, 1, 8));
