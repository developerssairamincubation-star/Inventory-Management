-- Append-only audit trail for every change to stock.
--
-- stock_transfers (V28) records domain-to-domain transfers, but nothing
-- recorded the other four ways stock moves — restocking from an invoice,
-- issuing a loan, taking a return, and writing units off as damaged or lost.
-- There was no way to answer "who changed this count, when, and why", which
-- is the first question anyone asks when a physical count disagrees with the
-- system.
--
-- Rows are written inside the same transaction as the stocks UPDATE they
-- describe, so the ledger cannot drift from the balance it explains: either
-- both land or neither does.

CREATE TABLE stock_ledger (
  entry_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SET NULL rather than CASCADE: the whole point of an audit trail is that
  -- it survives deletion of the thing it audits. product_name is denormalised
  -- for the same reason — so an entry stays readable after the product row is
  -- gone, exactly as purchase_invoice_item already does.
  product_id      UUID        REFERENCES products(product_id) ON DELETE SET NULL,
  product_name    TEXT        NOT NULL,

  -- What moved. Signed: negative removes from the shelf, positive returns to
  -- it. quantity_after is captured at write time so a reader never has to
  -- replay the whole ledger to know the balance at a point in time.
  reason          VARCHAR(32) NOT NULL CHECK (reason IN (
                    'PRODUCT_CREATED',
                    'INVOICE_RESTOCK',
                    'INVOICE_DELETED',
                    'LEND_ISSUED',
                    'LEND_RETURNED',
                    'LEND_DELETED',
                    'MARKED_DAMAGED',
                    'MARKED_LOST',
                    'MANUAL_ADJUSTMENT',
                    'TRANSFER_OUT',
                    'TRANSFER_IN'
                  )),
  quantity_delta  INTEGER     NOT NULL,
  quantity_after  INTEGER     NOT NULL CHECK (quantity_after >= 0),

  -- Who did it, and which request. request_id ties an entry to the structured
  -- server log line and the Sentry event for the same operation.
  actor_user_id   UUID        REFERENCES users(user_id) ON DELETE SET NULL,
  actor_email     VARCHAR(255),
  request_id      UUID,

  -- Whatever the change hangs off: a lending_order_id, an invoice_id, a
  -- transfer_id. Untyped on purpose — a FK per reason would need one nullable
  -- column each and buy nothing an audit reader wants.
  reference_id    UUID,
  note            TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_ledger_product   ON stock_ledger(product_id, created_at DESC);
CREATE INDEX idx_stock_ledger_actor     ON stock_ledger(actor_user_id, created_at DESC);
CREATE INDEX idx_stock_ledger_created   ON stock_ledger(created_at DESC);
CREATE INDEX idx_stock_ledger_reference ON stock_ledger(reference_id);

-- Append-only, enforced rather than merely intended. An audit trail the
-- application can quietly rewrite is not an audit trail. Corrections are made
-- by appending a compensating entry, never by editing history.
--
-- The one permitted UPDATE is the foreign-key cascade. Both product_id and
-- actor_user_id are ON DELETE SET NULL, so deleting a product or a user makes
-- Postgres itself null that column on every entry referencing it; a blanket
-- UPDATE ban would make those deletions impossible. The entry stays readable
-- through either cascade because product_name and actor_email are
-- denormalised onto the row for exactly this reason.
--
-- The check is written as "would this row be identical to the old one if the
-- nulled FK columns were restored?" — so the exemption covers precisely the
-- cascade and cannot be used to smuggle any other edit through alongside it.
CREATE OR REPLACE FUNCTION stock_ledger_is_append_only()
RETURNS TRIGGER AS $$
DECLARE
  restored stock_ledger%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    restored := NEW;

    -- Only a non-null -> null transition qualifies; anything else (including
    -- re-pointing an FK at a different row) falls through to the exception.
    IF OLD.product_id IS NOT NULL AND NEW.product_id IS NULL THEN
      restored.product_id := OLD.product_id;
    END IF;
    IF OLD.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NULL THEN
      restored.actor_user_id := OLD.actor_user_id;
    END IF;

    IF restored IS NOT DISTINCT FROM OLD THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'stock_ledger is append-only: % is not permitted. Append a compensating entry instead.', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_ledger_no_update
  BEFORE UPDATE OR DELETE ON stock_ledger
  FOR EACH ROW EXECUTE FUNCTION stock_ledger_is_append_only();
