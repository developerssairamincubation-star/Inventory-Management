-- Seeds a REALISTIC data volume so load tests exercise the queries that grow
-- with the catalogue instead of a 24-row toy database.
--
-- Why this exists: the endpoints most at risk here — GET /api/dashboard/stats,
-- GET /api/lending, GET /api/invoices — have no LIMIT and reduce their whole
-- result set in JavaScript. Against 24 products they are instant, and a load
-- test against 24 products therefore proves nothing about them. This builds
-- roughly a year of a busy COE's history.
--
-- Defaults (override with -v):
--   products  5,000      lending orders 50,000     invoices  2,000
--   students  3,000
-- Derived: ~75k lending items, ~20k invoice items, ~5k stock rows.
-- Total ~160k rows, built in a few seconds with set-based inserts.
--
-- Everything is prefixed `perfdata-` / `PERFDATA-`, deliberately NOT `k6-`,
-- so k6/seed/cleanup.sql (which keys on `k6-`) leaves this dataset alone
-- between runs. Remove it with k6/seed/perf-dataset-drop.sql.
--
-- Rows are owned by the seeded load-test accounts and attached to the
-- "K6 Load Test COE" domain, so a domain-scoped VU actually sees them —
-- authorization here is COE-scoped, and data owned by anyone else is
-- invisible to the test user no matter how much of it there is.
--
--   psql "$DATABASE_URL" -f k6/seed/perf-dataset.sql
--   psql "$DATABASE_URL" -v products=20000 -v orders=200000 -f k6/seed/perf-dataset.sql
--
-- Run k6/seed/load-users.sql FIRST — this depends on those accounts.

\set ON_ERROR_STOP on
\if :{?products} \else \set products 5000 \endif
\if :{?orders}   \else \set orders 50000 \endif
\if :{?students} \else \set students 3000 \endif
\if :{?invoices} \else \set invoices 2000 \endif

DO $$
BEGIN
  IF current_database() NOT IN ('inventory', 'inventory_test', 'inventory_loadtest') THEN
    RAISE EXCEPTION 'Refusing to seed a synthetic perf dataset into database "%".', current_database();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE email LIKE 'k6.load%@loadtest.local') THEN
    RAISE EXCEPTION 'No load-test accounts found. Run k6/seed/load-users.sql first.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM products WHERE product_name LIKE 'perfdata-%' LIMIT 1) THEN
    RAISE EXCEPTION 'A perfdata dataset already exists. Drop it first with k6/seed/perf-dataset-drop.sql, or you will double it.';
  END IF;
END $$;

BEGIN;

CREATE TEMP TABLE _ctx ON COMMIT DROP AS
SELECT
  (SELECT domain_id FROM coe_domains WHERE domain_name = 'K6 Load Test COE') AS domain_id,
  (SELECT department_id FROM departments WHERE department_name = 'K6 Load Test Dept') AS department_id,
  (SELECT category_id FROM category WHERE category_name = 'K6 Load Test Category') AS category_id;

CREATE TEMP TABLE _owners ON COMMIT DROP AS
SELECT user_id, row_number() OVER (ORDER BY email) - 1 AS idx, count(*) OVER () AS n
FROM users WHERE email LIKE 'k6.load%@loadtest.local';

-- ── Products ─────────────────────────────────────────────────────────────
-- sku_code and product_code are globally unique, so both are derived from the
-- series index rather than from a sequence — this bypasses id_sequences
-- entirely, which is intentional: seeding 5,000 rows through the atomic
-- allocator would serialise on one row for no benefit.
INSERT INTO products (product_name, category_id, unit_cost, sku_code, product_code, user_id, description, created_at)
SELECT
  'perfdata-product-' || i,
  (SELECT category_id FROM _ctx),
  round((random() * 20000 + 50)::numeric, 2),
  'PERFDATA-' || lpad(i::text, 7, '0'),
  'PERFDATA' || lpad(i::text, 7, '0'),
  (SELECT user_id FROM _owners WHERE idx = i % (SELECT n FROM _owners LIMIT 1)),
  'Synthetic row for performance testing.',
  now() - (random() * interval '365 days')
FROM generate_series(1, (:products)::int) AS i;

INSERT INTO stocks (product_id, quantity, location)
SELECT product_id, (random() * 500)::int + 50, 'Rack ' || chr(65 + (random() * 5)::int)
FROM products WHERE product_name LIKE 'perfdata-%';

-- ── Students ─────────────────────────────────────────────────────────────
-- student_id_code must satisfy src/lib/studentIdCode.ts:
--   [3 letters][2-digit year][2-letter dept][3-digit serial]
-- Serial is 3 digits, so a dept/year/college combination holds at most 1,000
-- students — the year and college are varied to reach larger counts.
INSERT INTO students (student_id_code, name, department_id, created_at)
SELECT
  (ARRAY['sit','sec'])[1 + (i / 1000) % 2] ||
  lpad((21 + (i / 2000) % 5)::text, 2, '0') || 'kx' || lpad((i % 1000)::text, 3, '0'),
  'perfdata Student ' || i,
  (SELECT department_id FROM _ctx),
  now() - (random() * interval '365 days')
FROM generate_series(1, (:students)::int) AS i
-- uq_students_id_code is a PARTIAL unique index
-- (WHERE student_id_code IS NOT NULL), so the inference clause has to repeat
-- the predicate — a bare ON CONFLICT (student_id_code) does not match it and
-- fails with "no unique or exclusion constraint matching the ON CONFLICT
-- specification".
ON CONFLICT (student_id_code) WHERE student_id_code IS NOT NULL DO NOTHING;

-- ── Lending orders ───────────────────────────────────────────────────────
-- Spread across a full year and weighted toward RETURNED, which is what a
-- real history looks like — GET /api/lending filters by period, so a dataset
-- bunched into one week would leave most period filters reading nothing.
INSERT INTO lending_order (borrower_type, borrower_student_id, issued_by_user_id, domain_id, due_date, return_date, status, created_at)
SELECT
  'STUDENT',
  s.student_id,
  (SELECT user_id FROM _owners WHERE idx = i % (SELECT n FROM _owners LIMIT 1)),
  (SELECT domain_id FROM _ctx),
  (now() - (random() * interval '365 days') + interval '14 days')::date,
  CASE WHEN random() < 0.8 THEN (now() - (random() * interval '300 days'))::date ELSE NULL END,
  (CASE WHEN random() < 0.8 THEN 'RETURNED' ELSE 'PENDING' END)::lending_order_status,
  now() - (random() * interval '365 days')
FROM generate_series(1, (:orders)::int) AS i
JOIN LATERAL (
  SELECT student_id FROM students WHERE name LIKE 'perfdata %'
  OFFSET (i % (SELECT greatest(count(*),1) FROM students WHERE name LIKE 'perfdata %')) LIMIT 1
) s ON TRUE;

-- ── Lending items ────────────────────────────────────────────────────────
-- ~1.5 lines per order, matching the real mix (most loans are one item).
INSERT INTO lending_item (lend_order_id, product_id, quantity, original_quantity, item_type, status, created_at)
SELECT
  lo.lending_order_id,
  p.product_id,
  -- chk_lending_item_quantities_balance enforces
  -- quantity + damaged + lost <= original_quantity, so `quantity` (the
  -- outstanding balance) is derived from original_quantity rather than drawn
  -- independently. A returned order has nothing outstanding.
  CASE WHEN lo.status = 'RETURNED' THEN 0 ELSE q.original END,
  q.original,
  'RETURNABLE'::lending_item_type_enum,
  (CASE WHEN lo.status = 'RETURNED' THEN 'RETURNED' ELSE 'ISSUED' END)::lending_item_status,
  lo.created_at
FROM lending_order lo
CROSS JOIN LATERAL (SELECT 1 + (random() * 3)::int AS original) q
JOIN LATERAL (
  SELECT product_id FROM products WHERE product_name LIKE 'perfdata-%'
  OFFSET (abs(hashtext(lo.lending_order_id::text)) % (SELECT greatest(count(*),1) FROM products WHERE product_name LIKE 'perfdata-%'))
  LIMIT 1
) p ON TRUE
WHERE lo.issued_by_user_id IN (SELECT user_id FROM _owners)
  AND NOT EXISTS (SELECT 1 FROM lending_item li WHERE li.lend_order_id = lo.lending_order_id);

-- ── Invoices ─────────────────────────────────────────────────────────────
INSERT INTO purchase_invoice (invoice_code, invoice_number, supplier_name, received_date, total_amount, user_id, created_at)
SELECT
  'PERFDATA-' || lpad(i::text, 7, '0'),
  'PERFDATA-INV-' || i,
  'perfdata-supplier-' || (i % 50),
  (now() - (random() * interval '365 days'))::date,
  round((random() * 200000)::numeric, 2),
  (SELECT user_id FROM _owners WHERE idx = i % (SELECT n FROM _owners LIMIT 1)),
  now() - (random() * interval '365 days')
FROM generate_series(1, (:invoices)::int) AS i;

INSERT INTO purchase_invoice_item (invoice_id, product_id, product_name, quantity, unit_cost, total_cost)
SELECT
  pi.invoice_id, p.product_id, p.product_name,
  q.quantity, p.unit_cost, round(q.quantity * p.unit_cost, 2)
FROM purchase_invoice pi
CROSS JOIN LATERAL generate_series(1, 10) AS line
CROSS JOIN LATERAL (SELECT 1 + (random() * 20)::int AS quantity) q
JOIN LATERAL (
  SELECT product_id, product_name, unit_cost FROM products WHERE product_name LIKE 'perfdata-%'
  OFFSET (abs(hashtext(pi.invoice_id::text || line::text)) % (SELECT greatest(count(*),1) FROM products WHERE product_name LIKE 'perfdata-%'))
  LIMIT 1
) p ON TRUE
WHERE pi.invoice_code LIKE 'PERFDATA-%'
  AND NOT EXISTS (SELECT 1 FROM purchase_invoice_item pii WHERE pii.invoice_id = pi.invoice_id);

COMMIT;

-- Planner statistics matter more than the rows: without this the optimiser
-- still believes these tables are tiny and picks sequential scans, so the
-- first load run measures a stale plan rather than the data.
ANALYZE products; ANALYZE stocks; ANALYZE students;
ANALYZE lending_order; ANALYZE lending_item;
ANALYZE purchase_invoice; ANALYZE purchase_invoice_item;

SELECT 'products' AS t, count(*) FROM products
UNION ALL SELECT 'stocks', count(*) FROM stocks
UNION ALL SELECT 'students', count(*) FROM students
UNION ALL SELECT 'lending_order', count(*) FROM lending_order
UNION ALL SELECT 'lending_item', count(*) FROM lending_item
UNION ALL SELECT 'purchase_invoice', count(*) FROM purchase_invoice
UNION ALL SELECT 'purchase_invoice_item', count(*) FROM purchase_invoice_item
ORDER BY 1;
