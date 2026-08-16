-- Per-item returnable/consumable marking. Previously this was only tracked
-- order-wide (lending_order.status) and never validated against the
-- product's own returnable/consumable flags; the coe-inventory lending
-- rewrite lets a single order mix returnable and consumable items, each
-- validated server-side at creation (see src/app/api/lending/route.ts).
--
-- Backfilled from the legacy per-item status so existing history stays
-- consistent: NON_RETURNABLE_GIVEN items become CONSUMABLE, everything else
-- (ISSUED etc.) becomes RETURNABLE.

CREATE TYPE lending_item_type_enum AS ENUM ('RETURNABLE', 'CONSUMABLE');

ALTER TABLE lending_item ADD COLUMN item_type lending_item_type_enum;

UPDATE lending_item SET item_type =
  (CASE WHEN status = 'NON_RETURNABLE_GIVEN' THEN 'CONSUMABLE' ELSE 'RETURNABLE' END)::lending_item_type_enum;

ALTER TABLE lending_item ALTER COLUMN item_type SET NOT NULL;
ALTER TABLE lending_item ALTER COLUMN item_type SET DEFAULT 'RETURNABLE';
