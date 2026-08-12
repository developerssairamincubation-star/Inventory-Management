-- Reporting views. Not yet queried by the app (dashboard routes currently
-- recompute these aggregates inline) but kept available for future use.

CREATE VIEW vw_low_stock AS
SELECT
  p.product_id,
  p.product_name,
  s.quantity,
  p.low_stock_threshold,
  (p.low_stock_threshold - s.quantity) AS deficit
FROM products p
JOIN stocks s ON s.product_id = p.product_id
WHERE s.quantity <= p.low_stock_threshold;

CREATE VIEW vw_top_lending_products AS
SELECT
  li.product_id,
  p.product_name,
  SUM(li.quantity) AS total_issued
FROM lending_item li
JOIN products p ON p.product_id = li.product_id
WHERE li.status IN (
  'ISSUED', 'RETURNED', 'OVERDUE', 'LOST', 'NON_RETURNABLE_GIVEN'
)
GROUP BY li.product_id, p.product_name
ORDER BY total_issued DESC;

CREATE VIEW vw_lending_status_distribution AS
SELECT
  status,
  COUNT(*) AS count
FROM lending_item
GROUP BY status;
