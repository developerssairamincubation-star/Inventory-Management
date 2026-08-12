-- Atomic counter table backing product_code (STICxxx) and invoice_number
-- (INVxxx) generation. Replaces the app-level "read last row, increment in
-- JS" pattern, which is race-prone under concurrent requests: a single
-- `UPDATE ... RETURNING` locks the row for the statement's duration, so
-- concurrent callers are serialized by Postgres instead of racing in app code.

CREATE TABLE id_sequences (
  sequence_key  TEXT   PRIMARY KEY,
  current_value BIGINT NOT NULL DEFAULT 0,
  prefix        TEXT   NOT NULL,
  pad_width     INT    NOT NULL DEFAULT 3,

  CONSTRAINT chk_id_sequences_current_value_nonnegative CHECK (current_value >= 0),
  CONSTRAINT chk_id_sequences_pad_width_positive        CHECK (pad_width > 0)
);

INSERT INTO id_sequences (sequence_key, current_value, prefix, pad_width) VALUES
  ('product_code',   0, 'STIC', 3),
  ('invoice_number', 0, 'INV',  3);
