-- Physical stock levels per product.

CREATE TABLE stocks (
  stock_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID        NOT NULL UNIQUE REFERENCES products(product_id) ON DELETE CASCADE,
  quantity         INT         NOT NULL DEFAULT 0,
  damaged_quantity INT         NOT NULL DEFAULT 0,
  lost_quantity    INT         NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_stock_quantity_nonnegative         CHECK (quantity >= 0),
  CONSTRAINT chk_stock_damaged_quantity_nonnegative CHECK (damaged_quantity >= 0),
  CONSTRAINT chk_stock_lost_quantity_nonnegative    CHECK (lost_quantity >= 0)
);

CREATE INDEX idx_stocks_quantity ON stocks(quantity);
