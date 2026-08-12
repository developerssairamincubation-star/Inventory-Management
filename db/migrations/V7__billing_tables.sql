-- Purchase invoices and their line items.

CREATE TABLE purchase_invoice (
  invoice_id     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name  VARCHAR(250)  NOT NULL,
  order_date     DATE,
  received_date  DATE,
  invoice_number VARCHAR(100),
  total_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
  user_id        UUID          REFERENCES users(user_id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT chk_total_amount_nonnegative CHECK (total_amount >= 0)
);

CREATE INDEX idx_purchase_invoice_dates ON purchase_invoice(order_date, received_date);

CREATE TABLE purchase_invoice_item (
  invoice_item_id UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID          NOT NULL REFERENCES purchase_invoice(invoice_id) ON DELETE CASCADE,
  product_id      UUID          REFERENCES products(product_id) ON DELETE RESTRICT,  -- nullable: line item may predate a matching product
  product_name    TEXT,
  quantity        INT           NOT NULL,
  unit_cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cost      NUMERIC(14,2) NOT NULL DEFAULT 0,

  CONSTRAINT chk_purchase_qty_positive          CHECK (quantity > 0),
  CONSTRAINT chk_purchase_unit_cost_nonnegative CHECK (unit_cost >= 0)
);

CREATE INDEX idx_purchase_invoice_item_invoice ON purchase_invoice_item(invoice_id);
CREATE INDEX idx_purchase_invoice_item_product ON purchase_invoice_item(product_id);

CREATE TABLE invoice_documents (
  doc_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          UUID        NOT NULL REFERENCES purchase_invoice(invoice_id) ON DELETE CASCADE,
  file_url            TEXT        NOT NULL,
  uploaded_by_user_id UUID        REFERENCES users(user_id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoice_documents_invoice ON invoice_documents(invoice_id);
