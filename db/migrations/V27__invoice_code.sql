-- Every invoice now gets a real, atomically-allocated, globally-unique
-- internal ID (invoice_code) — separate from invoice_number, which stays
-- free-text and user-editable for recording the supplier's own printed
-- invoice number (auto-filled from Gemini PDF parsing, but not guaranteed
-- unique or even present). Reuses the same id_sequences counter mechanism
-- already backing product_code (see src/lib/idSequences.ts).
--
-- Note: the id_sequences table's own V9 comment describes a per-user
-- invoice_number allocation design that was apparently never actually
-- implemented — src/lib/idSequences.ts only ever previewed a number and
-- let the client submit whatever it wanted, with no DB constraint at all.
-- This migration is the first real enforcement of invoice uniqueness.

INSERT INTO id_sequences (sequence_key, current_value, prefix, pad_width) VALUES
  ('invoice_code', 0, 'INV-', 4);

ALTER TABLE purchase_invoice ADD COLUMN invoice_code VARCHAR(50);

-- Backfill any pre-existing rows with real sequence values before
-- enforcing NOT NULL/UNIQUE below.
DO $$
DECLARE
  r RECORD;
  next_code TEXT;
BEGIN
  FOR r IN SELECT invoice_id FROM purchase_invoice WHERE invoice_code IS NULL ORDER BY created_at LOOP
    UPDATE id_sequences
      SET current_value = current_value + 1
      WHERE sequence_key = 'invoice_code'
      RETURNING prefix || lpad(current_value::text, pad_width, '0') INTO next_code;
    UPDATE purchase_invoice SET invoice_code = next_code WHERE invoice_id = r.invoice_id;
  END LOOP;
END $$;

ALTER TABLE purchase_invoice ALTER COLUMN invoice_code SET NOT NULL;
CREATE UNIQUE INDEX uq_purchase_invoice_invoice_code ON purchase_invoice(invoice_code);

-- Mirrors V22__products_sku_code_default.sql's reasoning: POST /api/invoices
-- (src/app/api/invoices/route.ts) always explicitly generates and sets
-- invoice_code via allocateNextCode — this default only exists so direct
-- INSERT INTO purchase_invoice statements (test fixtures, one-off scripts)
-- that don't care about invoice codes keep working. Obviously-not-a-real
-- code, distinguishable by its TMP- prefix.
ALTER TABLE purchase_invoice ALTER COLUMN invoice_code SET DEFAULT ('TMP-' || substr(gen_random_uuid()::text, 1, 8));
