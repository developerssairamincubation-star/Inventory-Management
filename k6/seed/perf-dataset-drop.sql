-- Removes the synthetic realistic-volume dataset created by perf-dataset.sql.
--
-- Keyed on the `perfdata-` / `PERFDATA-` prefixes, which are deliberately
-- distinct from the `k6-` prefix used by rows the load test itself writes —
-- so cleanup.sql (per-run) and this script (per-dataset) never tread on each
-- other, and neither touches real data.
--
-- Deletion order follows the FK graph: lending_item and invoice_item hold
-- onDelete: restrict references to products, so lines go before products, and
-- orders go before students.
--
--   psql "$DATABASE_URL" -f k6/seed/perf-dataset-drop.sql

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE _p ON COMMIT DROP AS
SELECT product_id FROM products WHERE product_name LIKE 'perfdata-%';

CREATE TEMP TABLE _i ON COMMIT DROP AS
SELECT invoice_id FROM purchase_invoice WHERE invoice_code LIKE 'PERFDATA-%';

CREATE TEMP TABLE _o ON COMMIT DROP AS
SELECT DISTINCT lo.lending_order_id
FROM lending_order lo
LEFT JOIN students s ON s.student_id = lo.borrower_student_id
LEFT JOIN lending_item li ON li.lend_order_id = lo.lending_order_id
WHERE s.name LIKE 'perfdata %' OR li.product_id IN (SELECT product_id FROM _p);

DELETE FROM lending_item WHERE lend_order_id IN (SELECT lending_order_id FROM _o);
DELETE FROM lending_item WHERE product_id IN (SELECT product_id FROM _p);
DELETE FROM lending_order WHERE lending_order_id IN (SELECT lending_order_id FROM _o);

DELETE FROM purchase_invoice_item WHERE invoice_id IN (SELECT invoice_id FROM _i);
DELETE FROM purchase_invoice_item WHERE product_id IN (SELECT product_id FROM _p);
DELETE FROM purchase_invoice WHERE invoice_id IN (SELECT invoice_id FROM _i);

-- stocks and product_image cascade from products.
DELETE FROM products WHERE product_id IN (SELECT product_id FROM _p);

DELETE FROM students
WHERE name LIKE 'perfdata %'
  AND student_id NOT IN (SELECT borrower_student_id FROM lending_order WHERE borrower_student_id IS NOT NULL);

COMMIT;

ANALYZE products; ANALYZE lending_order; ANALYZE lending_item;
ANALYZE purchase_invoice; ANALYZE purchase_invoice_item; ANALYZE students;

SELECT 'products' AS t, count(*) FROM products WHERE product_name LIKE 'perfdata-%'
UNION ALL SELECT 'invoices', count(*) FROM purchase_invoice WHERE invoice_code LIKE 'PERFDATA-%'
UNION ALL SELECT 'students', count(*) FROM students WHERE name LIKE 'perfdata %';
