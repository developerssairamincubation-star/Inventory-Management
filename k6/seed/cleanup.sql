-- Removes rows created by the k6 performance suite.
--
-- Deletion order follows the FK graph, because several of these are
-- onDelete: restrict and will refuse rather than cascade:
--   lending_item  -> products  (restrict)
--   invoice_item  -> products  (restrict)
--   lending_order -> students  (restrict)
-- so line items go before products, and orders go before students.
-- stocks / product_image / invoice_documents cascade from their parent;
-- stock_ledger and stock_transfers are set-null, so their audit rows survive
-- the product deletion on purpose — they are the history, not the data.
--
-- Scope: by default this removes EVERY k6 run's rows (name prefix 'k6-').
-- Pass -v run_id to limit it to one run — the id k6 prints at setup and
-- teardown:
--
--   psql "$DATABASE_URL" -f k6/seed/cleanup.sql                       -- all k6 rows
--   psql "$DATABASE_URL" -v run_id="'rmf3k2x1'" -f k6/seed/cleanup.sql -- one run
--
-- The local dev database in this project is persistent and holds real
-- accumulated data. Everything below is anchored on the 'k6-' / 'K6-' naming
-- the suite applies to every row it creates (k6/lib/data.js), so nothing
-- else can match. Run the SELECTs at the bottom first if you want to see the
-- blast radius before committing.

\set ON_ERROR_STOP on
\if :{?run_id} \else \set run_id NULL \endif

BEGIN;

-- Which products belong to this cleanup.
CREATE TEMP TABLE k6_products ON COMMIT DROP AS
SELECT product_id
FROM products
WHERE product_name LIKE 'k6-%'
  AND (:run_id IS NULL OR product_name LIKE 'k6-' || :run_id || '-%');

CREATE TEMP TABLE k6_invoices ON COMMIT DROP AS
SELECT invoice_id
FROM purchase_invoice
WHERE (supplier_name LIKE 'k6-%' OR invoice_number LIKE 'K6-%')
  AND (:run_id IS NULL OR supplier_name LIKE 'k6-' || :run_id || '-%' OR invoice_number LIKE 'K6-' || :run_id || '-%');

-- Lending orders that touch a k6 product, plus orders placed by k6 students.
CREATE TEMP TABLE k6_orders ON COMMIT DROP AS
SELECT DISTINCT lo.lending_order_id
FROM lending_order lo
LEFT JOIN lending_item li ON li.lend_order_id = lo.lending_order_id
LEFT JOIN students s ON s.student_id = lo.borrower_student_id
WHERE li.product_id IN (SELECT product_id FROM k6_products)
   OR s.name LIKE 'K6 Student %';

DELETE FROM lending_item WHERE lend_order_id IN (SELECT lending_order_id FROM k6_orders);
DELETE FROM lending_item WHERE product_id IN (SELECT product_id FROM k6_products);
DELETE FROM lending_order WHERE lending_order_id IN (SELECT lending_order_id FROM k6_orders);

DELETE FROM purchase_invoice_item WHERE invoice_id IN (SELECT invoice_id FROM k6_invoices);
DELETE FROM purchase_invoice_item WHERE product_id IN (SELECT product_id FROM k6_products);
DELETE FROM purchase_invoice WHERE invoice_id IN (SELECT invoice_id FROM k6_invoices);

-- stocks and product_image cascade; the ledger and transfer rows null out.
DELETE FROM products WHERE product_id IN (SELECT product_id FROM k6_products);

-- Students the lending flow created, now that no order references them.
DELETE FROM students
WHERE name LIKE 'K6 Student %'
  AND student_id NOT IN (SELECT borrower_student_id FROM lending_order WHERE borrower_student_id IS NOT NULL);

-- Ledger rows whose product is gone and whose note names a k6 run. Optional —
-- comment this out to keep the full audit trail.
DELETE FROM stock_ledger
WHERE product_id IS NULL
  AND note LIKE '%k6-%';

COMMIT;

-- What is left, for confirmation.
SELECT 'products'      AS table, count(*) FROM products          WHERE product_name  LIKE 'k6-%'
UNION ALL
SELECT 'invoices',            count(*) FROM purchase_invoice     WHERE supplier_name LIKE 'k6-%' OR invoice_number LIKE 'K6-%'
UNION ALL
SELECT 'students',            count(*) FROM students             WHERE name          LIKE 'K6 Student %'
UNION ALL
SELECT 'k6 accounts',         count(*) FROM users                WHERE email         LIKE 'k6.load%@loadtest.local';
