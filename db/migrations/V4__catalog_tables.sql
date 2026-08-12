-- Product catalog: category, products, product images.

CREATE TABLE category (
  category_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name TEXT        NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  product_id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name        VARCHAR(250)  NOT NULL,
  category_id         UUID          REFERENCES category(category_id) ON DELETE SET NULL,
  unit_cost           NUMERIC(12,2) NOT NULL DEFAULT 0,
  returnable          BOOLEAN       NOT NULL DEFAULT TRUE,
  consumable          BOOLEAN       NOT NULL DEFAULT FALSE,
  low_stock_threshold INT           NOT NULL DEFAULT 0,
  serial_number       VARCHAR(100),
  product_code        TEXT          UNIQUE,
  user_id             UUID          REFERENCES users(user_id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT chk_unit_cost_nonnegative           CHECK (unit_cost >= 0),
  CONSTRAINT chk_low_stock_threshold_nonnegative CHECK (low_stock_threshold >= 0)
);

CREATE INDEX idx_products_name        ON products(product_name);
CREATE INDEX idx_products_category_id ON products(category_id);

CREATE TABLE product_image (
  image_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID        NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  image_url  TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_image_product ON product_image(product_id);
