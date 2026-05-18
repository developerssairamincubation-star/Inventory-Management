-- =========================================================
-- 001_initial_schema.sql
-- MONOLITH INVENTORY DB  (PostgreSQL / Supabase)
-- Clean migration — final schema state
-- No RLS · No auth.users refs · No storage · Plain DDL only
-- =========================================================


-- =========================================================
-- 0) EXTENSIONS
-- =========================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =========================================================
-- 1) ENUM TYPES
-- =========================================================

CREATE TYPE borrower_type_enum AS ENUM (
  'STUDENT',
  'STAFF'
);

CREATE TYPE lending_item_status AS ENUM (
  'ISSUED',
  'RETURNED',
  'OVERDUE',
  'LOST',
  'NON_RETURNABLE_GIVEN'
);

CREATE TYPE lending_order_status AS ENUM (
  'PENDING',
  'RETURNED',
  'CONSUMABLE',
  'PARTIALLY_RETURNED',
  'PARTIALLY_DAMAGED',
  'PARTIALLY_LOST',
  'RETURNED_DAMAGED',
  'RETURNED_LOST',
  'DAMAGED',
  'LOST'
);


-- =========================================================
-- 2) IAM
-- =========================================================

CREATE TABLE departments (
  department_id   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  department_name VARCHAR(150) NOT NULL UNIQUE,
  created_at      TIMESTAMP    NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE TABLE users (
  user_id       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  full_name     VARCHAR(200) NOT NULL,
  department_id UUID         REFERENCES departments(department_id) ON DELETE SET NULL,
  firebase_uid  TEXT,
  role          TEXT,
  is_active     BOOLEAN,
  created_at    TIMESTAMP    NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  session_id    UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID      NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token         TEXT      NOT NULL UNIQUE,
  last_activity TIMESTAMP NOT NULL DEFAULT now(),
  created_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user_id       ON sessions(user_id);
CREATE INDEX idx_sessions_last_activity ON sessions(last_activity);


-- =========================================================
-- 3) PEOPLE
-- =========================================================

CREATE TABLE students (
  student_id     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(200) NOT NULL,
  department_id  UUID         REFERENCES departments(department_id) ON DELETE SET NULL,
  email          VARCHAR(255) UNIQUE,
  phone_number   VARCHAR(30),
  student_number TEXT,
  created_at     TIMESTAMP    NOT NULL DEFAULT now(),
  updated_at     TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE INDEX idx_students_department ON students(department_id);
CREATE INDEX idx_students_name       ON students(name);

CREATE TABLE staffs (
  staff_id      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(200) NOT NULL,
  department_id UUID         REFERENCES departments(department_id) ON DELETE SET NULL,
  email         VARCHAR(255) UNIQUE,
  phone_number  VARCHAR(30),
  employee_id   TEXT,
  created_at    TIMESTAMP    NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE INDEX idx_staffs_department ON staffs(department_id);
CREATE INDEX idx_staffs_name       ON staffs(name);


-- =========================================================
-- 4) CATALOG
-- =========================================================

CREATE TABLE category (
  category_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name TEXT        NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ DEFAULT now()
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
  created_at          TIMESTAMP     NOT NULL DEFAULT now(),
  updated_at          TIMESTAMP     NOT NULL DEFAULT now(),

  CONSTRAINT chk_unit_cost_nonnegative           CHECK (unit_cost >= 0),
  CONSTRAINT chk_low_stock_threshold_nonnegative CHECK (low_stock_threshold >= 0)
);

CREATE INDEX idx_products_name        ON products(product_name);
CREATE INDEX idx_products_category_id ON products(category_id);

CREATE TABLE product_image (
  image_id   UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID      NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  image_url  TEXT      NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_image_product ON product_image(product_id);


-- =========================================================
-- 5) INVENTORY
-- =========================================================

CREATE TABLE stocks (
  stock_id         UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID      NOT NULL UNIQUE REFERENCES products(product_id) ON DELETE CASCADE,
  quantity         INT       NOT NULL DEFAULT 0,
  damaged_quantity INT       NOT NULL DEFAULT 0,
  lost_quantity    INT       NOT NULL DEFAULT 0,
  created_at       TIMESTAMP NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT chk_stock_quantity_nonnegative CHECK (quantity >= 0)
);

CREATE INDEX idx_stocks_quantity ON stocks(quantity);


-- =========================================================
-- 6) LENDING
-- =========================================================

CREATE TABLE lending_order (
  lending_order_id    UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  borrower_type       borrower_type_enum   NOT NULL,
  borrower_student_id UUID                 REFERENCES students(student_id) ON DELETE RESTRICT,
  borrower_staff_id   UUID                 REFERENCES staffs(staff_id)    ON DELETE RESTRICT,
  issued_by_user_id   UUID                 REFERENCES users(user_id)      ON DELETE SET NULL,
  project_name        VARCHAR(255),
  mentor_staff_id     UUID                 REFERENCES staffs(staff_id),
  due_date            DATE,
  return_date         DATE,
  status              lending_order_status DEFAULT 'PENDING',
  created_at          TIMESTAMP            NOT NULL DEFAULT now(),
  updated_at          TIMESTAMP            NOT NULL DEFAULT now(),

  CONSTRAINT chk_lending_borrower_one CHECK (
    (borrower_type = 'STUDENT' AND borrower_student_id IS NOT NULL AND borrower_staff_id IS NULL)
    OR
    (borrower_type = 'STAFF'   AND borrower_staff_id   IS NOT NULL AND borrower_student_id IS NULL)
  )
);

CREATE INDEX idx_lending_order_status  ON lending_order(status);
CREATE INDEX idx_lending_order_created ON lending_order(created_at);

CREATE TABLE lending_item (
  lending_item_id   UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  lend_order_id     UUID                NOT NULL REFERENCES lending_order(lending_order_id) ON DELETE CASCADE,
  product_id        UUID                NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
  quantity          INT                 NOT NULL,
  status            lending_item_status NOT NULL DEFAULT 'ISSUED',
  original_quantity INT                 NOT NULL DEFAULT 0,
  damaged_quantity  INT                 NOT NULL DEFAULT 0,
  lost_quantity     INT                 NOT NULL DEFAULT 0,
  created_at        TIMESTAMP           NOT NULL DEFAULT now(),
  updated_at        TIMESTAMP           NOT NULL DEFAULT now(),

  CONSTRAINT chk_lending_qty_non_negative CHECK (quantity >= 0)
);

CREATE INDEX idx_lending_item_order   ON lending_item(lend_order_id);
CREATE INDEX idx_lending_item_product ON lending_item(product_id);
CREATE INDEX idx_lending_item_status  ON lending_item(status);


-- =========================================================
-- 7) BILLING
-- =========================================================

CREATE TABLE purchase_invoice (
  invoice_id     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name  VARCHAR(250)  NOT NULL,
  order_date     DATE,
  received_date  DATE,
  invoice_number VARCHAR(100),
  total_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
  user_id        UUID          REFERENCES users(user_id) ON DELETE SET NULL,
  created_at     TIMESTAMP     NOT NULL DEFAULT now(),
  updated_at     TIMESTAMP     NOT NULL DEFAULT now(),

  CONSTRAINT chk_total_amount_nonnegative CHECK (total_amount >= 0)
);

CREATE INDEX idx_purchase_invoice_dates ON purchase_invoice(order_date, received_date);

CREATE TABLE purchase_invoice_item (
  invoice_item_id UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID          NOT NULL REFERENCES purchase_invoice(invoice_id) ON DELETE CASCADE,
  product_id      UUID          REFERENCES products(product_id) ON DELETE RESTRICT,  -- nullable
  product_name    TEXT,
  quantity        INT           NOT NULL,
  unit_cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cost      NUMERIC       NOT NULL DEFAULT 0,

  CONSTRAINT chk_purchase_qty_positive          CHECK (quantity > 0),
  CONSTRAINT chk_purchase_unit_cost_nonnegative CHECK (unit_cost >= 0)
);

CREATE INDEX idx_purchase_invoice_item_invoice ON purchase_invoice_item(invoice_id);
CREATE INDEX idx_purchase_invoice_item_product ON purchase_invoice_item(product_id);

CREATE TABLE invoice_documents (
  doc_id              UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          UUID      NOT NULL REFERENCES purchase_invoice(invoice_id) ON DELETE CASCADE,
  file_url            TEXT      NOT NULL,
  uploaded_by_user_id UUID      REFERENCES users(user_id) ON DELETE SET NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT now(),
  updated_at          TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoice_documents_invoice ON invoice_documents(invoice_id);


-- =========================================================
-- 8) NOTIFICATIONS
-- =========================================================

CREATE TABLE notifications (
  notification_id   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type VARCHAR(50)  NOT NULL,
  title             VARCHAR(200) NOT NULL,
  message           TEXT         NOT NULL
);


-- =========================================================
-- 9) REPORTING VIEWS
-- =========================================================

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


-- =========================================================
-- END OF MIGRATION
-- =========================================================
