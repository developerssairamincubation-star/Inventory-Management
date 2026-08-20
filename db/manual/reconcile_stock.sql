-- Stock reconciliation — READ THIS BEFORE RUNNING ANYTHING BELOW.
--
-- Deliberately NOT a Flyway migration. It lives outside db/migrations so it
-- can never run automatically on deploy: it rewrites live inventory counts,
-- and nobody but you can confirm what the shelves actually hold.
--
-- Why it exists. Two defects corrupted stock over time:
--
--   1. Marking a loaned item lost or damaged decremented stocks.quantity a
--      second time. Those units had already left the shelf when the loan was
--      issued, so every write-off was counted out of inventory twice.
--
--   2. `Math.max(0, quantity - n)` clamped instead of failing, so an
--      over-issue silently wrote 0 and lost the discrepancy. That one cannot
--      be reversed arithmetically — the original figure is simply gone. The
--      reports in Part 1 surface where it likely happened so a human can
--      recount.
--
-- The code no longer does either. This file corrects the history they left.
--
-- Procedure:
--   1. Take a backup. Confirm you can restore it.
--   2. Run Part 1 (read-only) and read the output.
--   3. Recount anything Part 1 flags as unreconcilable.
--   4. Run Part 2 inside a transaction, inspect, then COMMIT or ROLLBACK.

-- ════════════════════════════════════════════════════════════════════════
-- PART 1 — REPORTS (read-only, safe to run any time)
-- ════════════════════════════════════════════════════════════════════════

-- 1a. Double-deducted units.
--
-- For each product, how much stock the lost/damaged double-deduction removed
-- that should never have been removed. `suggested_correction` is how many
-- units to add back.
--
-- Only write-offs recorded against a lending order count: those are the units
-- that had already left the shelf. A write-off on a product never lent out
-- was a single, correct deduction.
SELECT
  p.product_id,
  p.product_name,
  p.sku_code,
  s.quantity                      AS current_quantity,
  s.damaged_quantity,
  s.lost_quantity,
  COALESCE(li.written_off, 0)     AS written_off_while_on_loan,
  s.quantity + COALESCE(li.written_off, 0) AS quantity_after_correction,
  COALESCE(li.written_off, 0)     AS suggested_correction
FROM products p
JOIN stocks s ON s.product_id = p.product_id
LEFT JOIN (
  SELECT product_id, SUM(damaged_quantity + lost_quantity) AS written_off
  FROM lending_item
  GROUP BY product_id
) li ON li.product_id = p.product_id
WHERE COALESCE(li.written_off, 0) > 0
ORDER BY suggested_correction DESC;

-- 1b. Products whose counters disagree with their lending history.
--
-- stocks.damaged_quantity / lost_quantity should equal the sum of the
-- per-item write-offs. A mismatch means something wrote one without the
-- other, and the row needs a human decision rather than arithmetic.
SELECT
  p.product_id,
  p.product_name,
  s.damaged_quantity              AS stocks_damaged,
  COALESCE(li.damaged, 0)         AS lending_damaged,
  s.lost_quantity                 AS stocks_lost,
  COALESCE(li.lost, 0)            AS lending_lost
FROM products p
JOIN stocks s ON s.product_id = p.product_id
LEFT JOIN (
  SELECT product_id, SUM(damaged_quantity) AS damaged, SUM(lost_quantity) AS lost
  FROM lending_item
  GROUP BY product_id
) li ON li.product_id = p.product_id
WHERE s.damaged_quantity IS DISTINCT FROM COALESCE(li.damaged, 0)
   OR s.lost_quantity    IS DISTINCT FROM COALESCE(li.lost, 0)
ORDER BY p.product_name;

-- 1c. Rows that would fail the V29 constraints.
--
-- V29 added its CHECKs as NOT VALID, so they bind new writes but were never
-- verified against existing rows. Everything listed here must be corrected
-- before those constraints can be validated.
SELECT 'lending_item' AS table_name, lending_item_id AS id,
       'quantity + damaged + lost exceeds original_quantity' AS problem
FROM lending_item
WHERE quantity + damaged_quantity + lost_quantity > original_quantity
UNION ALL
SELECT 'lending_item', lending_item_id, 'negative quantity'
FROM lending_item
WHERE quantity < 0 OR original_quantity < 0 OR damaged_quantity < 0 OR lost_quantity < 0
UNION ALL
SELECT 'purchase_invoice_item', invoice_item_id, 'quantity is not positive'
FROM purchase_invoice_item
WHERE quantity <= 0
UNION ALL
SELECT 'purchase_invoice_item', invoice_item_id, 'negative cost'
FROM purchase_invoice_item
WHERE unit_cost < 0 OR total_cost < 0;

-- 1d. Suspected clamped over-issues — NOT auto-correctable.
--
-- A product sitting at exactly zero with outstanding loans is the signature
-- of `Math.max(0, ...)` having swallowed an over-issue. The true figure was
-- destroyed at write time, so these need a physical recount.
SELECT
  p.product_id,
  p.product_name,
  p.sku_code,
  s.quantity                AS current_quantity,
  SUM(li.quantity)          AS still_on_loan
FROM products p
JOIN stocks s       ON s.product_id = p.product_id
JOIN lending_item li ON li.product_id = p.product_id
WHERE s.quantity = 0 AND li.quantity > 0
GROUP BY p.product_id, p.product_name, p.sku_code, s.quantity
ORDER BY still_on_loan DESC;

-- ════════════════════════════════════════════════════════════════════════
-- PART 2 — CORRECTION (writes; run only after reviewing Part 1)
-- ════════════════════════════════════════════════════════════════════════
--
-- Wrapped in an explicit transaction with no COMMIT. Run it, inspect the
-- verification query, then type COMMIT or ROLLBACK yourself. Uncomment to use.

-- BEGIN;
--
-- -- Add back the units the double-deduction removed. Every correction is
-- -- written to stock_ledger as a MANUAL_ADJUSTMENT with a NULL actor, which
-- -- is how the trail records "a migration did this, not a person".
-- WITH corrections AS (
--   SELECT
--     s.product_id,
--     p.product_name,
--     s.quantity AS before_quantity,
--     SUM(li.damaged_quantity + li.lost_quantity)::int AS correction
--   FROM stocks s
--   JOIN products p     ON p.product_id = s.product_id
--   JOIN lending_item li ON li.product_id = s.product_id
--   GROUP BY s.product_id, p.product_name, s.quantity
--   HAVING SUM(li.damaged_quantity + li.lost_quantity) > 0
-- ),
-- applied AS (
--   UPDATE stocks s
--   SET quantity = s.quantity + c.correction
--   FROM corrections c
--   WHERE s.product_id = c.product_id
--   RETURNING s.product_id, s.quantity AS after_quantity
-- )
-- INSERT INTO stock_ledger (
--   product_id, product_name, reason, quantity_delta, quantity_after,
--   actor_user_id, actor_email, note
-- )
-- SELECT
--   c.product_id,
--   c.product_name,
--   'MANUAL_ADJUSTMENT',
--   c.correction,
--   a.after_quantity,
--   NULL,
--   NULL,
--   'Reconciliation: reversed the lost/damaged double-deduction (db/manual/reconcile_stock.sql)'
-- FROM corrections c
-- JOIN applied a ON a.product_id = c.product_id;
--
-- -- Verify before committing: this should return no rows.
-- SELECT product_id, quantity FROM stocks WHERE quantity < 0;
--
-- COMMIT;   -- or ROLLBACK;

-- ════════════════════════════════════════════════════════════════════════
-- PART 3 — VALIDATE THE V29 CONSTRAINTS (only once Part 1c returns nothing)
-- ════════════════════════════════════════════════════════════════════════
--
-- Each takes a SHARE UPDATE EXCLUSIVE lock and scans the table; run off-peak.
-- Any row still in violation aborts the statement, which is the point.

-- ALTER TABLE lending_item          VALIDATE CONSTRAINT chk_lending_item_quantity_nonnegative;
-- ALTER TABLE lending_item          VALIDATE CONSTRAINT chk_lending_item_original_quantity_nonnegative;
-- ALTER TABLE lending_item          VALIDATE CONSTRAINT chk_lending_item_damaged_quantity_nonnegative;
-- ALTER TABLE lending_item          VALIDATE CONSTRAINT chk_lending_item_lost_quantity_nonnegative;
-- ALTER TABLE lending_item          VALIDATE CONSTRAINT chk_lending_item_quantities_balance;
-- ALTER TABLE purchase_invoice_item VALIDATE CONSTRAINT chk_purchase_invoice_item_quantity_positive;
-- ALTER TABLE purchase_invoice_item VALIDATE CONSTRAINT chk_purchase_invoice_item_unit_cost_nonnegative;
-- ALTER TABLE purchase_invoice_item VALIDATE CONSTRAINT chk_purchase_invoice_item_total_cost_nonnegative;
-- ALTER TABLE purchase_invoice      VALIDATE CONSTRAINT chk_purchase_invoice_total_amount_nonnegative;
