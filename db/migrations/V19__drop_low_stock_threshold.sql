-- Low-stock threshold feature removed for the coe-inventory rework — no
-- replacement mechanism, per-product reorder points aren't part of this
-- use case. vw_low_stock must be dropped first since it selects the column.

DROP VIEW IF EXISTS vw_low_stock;
ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_low_stock_threshold_nonnegative;
ALTER TABLE products DROP COLUMN low_stock_threshold;
