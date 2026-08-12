-- Indexes added beyond the original Supabase-era schema, driven by actual
-- hot filter columns observed in src/app/api/**/route.ts query patterns.

-- Every lending list/dashboard query filters by issued_by_user_id; it had no
-- supporting index before this migration.
CREATE INDEX idx_lending_order_issued_by ON lending_order(issued_by_user_id);

-- Ownership filters used on nearly every products/invoices query.
CREATE INDEX idx_products_user_id        ON products(user_id);
CREATE INDEX idx_purchase_invoice_user_id ON purchase_invoice(user_id);

-- Student/staff lending-history lookups (student and staff detail pages).
CREATE INDEX idx_lending_order_borrower_student ON lending_order(borrower_student_id);
CREATE INDEX idx_lending_order_borrower_staff   ON lending_order(borrower_staff_id);
