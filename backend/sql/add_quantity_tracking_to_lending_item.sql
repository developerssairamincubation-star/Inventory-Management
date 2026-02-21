-- Migration: Track borrowed/damaged/lost quantities per lending_item row
-- Run this in your Supabase SQL editor.

-- 1. Relax the check constraint so quantity can reach 0
--    (when all items in a row are damaged or lost, we keep the row for history)
ALTER TABLE lending_item DROP CONSTRAINT IF EXISTS chk_lending_qty_positive;
ALTER TABLE lending_item ADD CONSTRAINT chk_lending_qty_non_negative CHECK (quantity >= 0);

-- 2. Add tracking columns
ALTER TABLE lending_item ADD COLUMN IF NOT EXISTS original_quantity INTEGER;
ALTER TABLE lending_item ADD COLUMN IF NOT EXISTS damaged_quantity  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lending_item ADD COLUMN IF NOT EXISTS lost_quantity     INTEGER NOT NULL DEFAULT 0;

-- 3. Back-fill original_quantity for existing rows (assume no damage/loss yet)
UPDATE lending_item SET original_quantity = quantity WHERE original_quantity IS NULL;
ALTER TABLE lending_item ALTER COLUMN original_quantity SET NOT NULL;
ALTER TABLE lending_item ALTER COLUMN original_quantity SET DEFAULT 0;
