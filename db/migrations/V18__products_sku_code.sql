-- The existing serial_number column has been the UI's "SKU" field all
-- along (see the "SKU" column in src/app/(admin)/products/page.tsx) — this
-- is a plain rename to sku_code, not a new field. It moves from
-- manually-typed to auto-generated, category-scoped, and barcode-printable
-- in a later phase; the NOT NULL + unique index land once every existing
-- product has a generated value (see V21).

ALTER TABLE products RENAME COLUMN serial_number TO sku_code;
