-- Quantity CHECK constraints — the database-level backstop for the stock
-- inflation bugs.
--
-- `stocks` has carried non-negative CHECKs since V5, but `lending_item` and
-- `purchase_invoice_item` had none at all. That is what let an unvalidated
-- negative `quantity` from a request body persist: the lending route computed
-- `Math.max(0, stock - quantity)`, so a negative quantity turned the
-- subtraction into an addition and inflated stock, and the resulting nonsense
-- line item was accepted by the schema without complaint.
--
-- The application now validates every quantity (src/lib/validation.ts), but
-- validation that lives only in the application is one forgotten route away
-- from being absent again. These constraints mean the database refuses the
-- write regardless of which code path attempts it.
--
-- NOT VALID is deliberate. It enforces the constraint on every INSERT and
-- UPDATE from here on, but skips the full-table scan of existing rows — so
-- this migration cannot fail on legacy data that already carries corrupt
-- values from the bugs above. Reconcile first (see
-- db/manual/reconcile_stock.sql), then run the VALIDATE statements at the
-- bottom of this file to also guarantee the historical rows.

-- lending_item.quantity is the *outstanding* balance, so 0 is legitimate:
-- it's what a fully-returned line item holds. Negative never is.
ALTER TABLE lending_item
  ADD CONSTRAINT chk_lending_item_quantity_nonnegative
  CHECK (quantity >= 0) NOT VALID;

ALTER TABLE lending_item
  ADD CONSTRAINT chk_lending_item_original_quantity_nonnegative
  CHECK (original_quantity >= 0) NOT VALID;

ALTER TABLE lending_item
  ADD CONSTRAINT chk_lending_item_damaged_quantity_nonnegative
  CHECK (damaged_quantity >= 0) NOT VALID;

ALTER TABLE lending_item
  ADD CONSTRAINT chk_lending_item_lost_quantity_nonnegative
  CHECK (lost_quantity >= 0) NOT VALID;

-- Damaged and lost units are drawn from what was originally issued, so their
-- sum can never exceed it. This is the invariant the damage/lost routes are
-- supposed to maintain and previously enforced only in application code.
ALTER TABLE lending_item
  ADD CONSTRAINT chk_lending_item_quantities_balance
  CHECK (quantity + damaged_quantity + lost_quantity <= original_quantity) NOT VALID;

-- An invoice line for zero or fewer units is not a thing.
ALTER TABLE purchase_invoice_item
  ADD CONSTRAINT chk_purchase_invoice_item_quantity_positive
  CHECK (quantity > 0) NOT VALID;

ALTER TABLE purchase_invoice_item
  ADD CONSTRAINT chk_purchase_invoice_item_unit_cost_nonnegative
  CHECK (unit_cost >= 0) NOT VALID;

ALTER TABLE purchase_invoice_item
  ADD CONSTRAINT chk_purchase_invoice_item_total_cost_nonnegative
  CHECK (total_cost >= 0) NOT VALID;

ALTER TABLE purchase_invoice
  ADD CONSTRAINT chk_purchase_invoice_total_amount_nonnegative
  CHECK (total_amount >= 0) NOT VALID;

-- After reconciling historical data, run these to validate the existing rows
-- too. Each takes a SHARE UPDATE EXCLUSIVE lock and scans the table, so run
-- them off-peak. Left commented rather than executed because they will abort
-- this migration if any legacy row still violates them.
--
-- ALTER TABLE lending_item          VALIDATE CONSTRAINT chk_lending_item_quantity_nonnegative;
-- ALTER TABLE lending_item          VALIDATE CONSTRAINT chk_lending_item_original_quantity_nonnegative;
-- ALTER TABLE lending_item          VALIDATE CONSTRAINT chk_lending_item_damaged_quantity_nonnegative;
-- ALTER TABLE lending_item          VALIDATE CONSTRAINT chk_lending_item_lost_quantity_nonnegative;
-- ALTER TABLE lending_item          VALIDATE CONSTRAINT chk_lending_item_quantities_balance;
-- ALTER TABLE purchase_invoice_item VALIDATE CONSTRAINT chk_purchase_invoice_item_quantity_positive;
-- ALTER TABLE purchase_invoice_item VALIDATE CONSTRAINT chk_purchase_invoice_item_unit_cost_nonnegative;
-- ALTER TABLE purchase_invoice_item VALIDATE CONSTRAINT chk_purchase_invoice_item_total_cost_nonnegative;
-- ALTER TABLE purchase_invoice      VALIDATE CONSTRAINT chk_purchase_invoice_total_amount_nonnegative;
