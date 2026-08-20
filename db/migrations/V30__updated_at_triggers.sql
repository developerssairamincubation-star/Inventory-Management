-- Make updated_at actually mean something.
--
-- Twelve tables declare `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, but
-- nothing ever maintained it: there were no triggers, and no route set the
-- column on update. Every row in the database therefore reported
-- `updated_at = created_at` forever. Anyone reading it during an incident —
-- "when did this stock level last change?" — got a confidently wrong answer,
-- which is worse than having no column at all.
--
-- A trigger rather than application code, so it holds for every writer:
-- routes, migrations, psql sessions, and any future service.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Guard against a no-op UPDATE bumping the timestamp. Postgres fires
  -- BEFORE UPDATE even when no column actually changed (e.g. an idempotent
  -- upsert), and treating that as a modification would make updated_at just
  -- as untrustworthy in the other direction.
  IF NEW IS DISTINCT FROM OLD THEN
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'departments',
    'users',
    'students',
    'products',
    'product_image',
    'stocks',
    'lending_order',
    'lending_item',
    'purchase_invoice',
    'invoice_documents',
    'coe_domains'
  ]
  LOOP
    -- Only wire up tables that exist and actually have the column, so this
    -- stays correct if an earlier migration is ever reordered or a table is
    -- dropped later (V26 already dropped password_reset_tokens).
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = target_table
        AND column_name = 'updated_at'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I', target_table);
      EXECUTE format(
        'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
        target_table
      );
    END IF;
  END LOOP;
END;
$$;
