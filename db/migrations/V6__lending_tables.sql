-- Lending orders and their line items.

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
  status              lending_order_status NOT NULL DEFAULT 'PENDING',
  created_at          TIMESTAMPTZ          NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ          NOT NULL DEFAULT now(),

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
  created_at        TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ         NOT NULL DEFAULT now(),

  CONSTRAINT chk_lending_qty_non_negative CHECK (quantity >= 0)
);

CREATE INDEX idx_lending_item_order   ON lending_item(lend_order_id);
CREATE INDEX idx_lending_item_product ON lending_item(product_id);
CREATE INDEX idx_lending_item_status  ON lending_item(status);
