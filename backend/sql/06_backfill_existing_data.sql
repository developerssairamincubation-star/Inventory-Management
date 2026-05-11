-- Migration: Backfill user_id on existing rows after super admin is created.
-- Run this AFTER:
--   1. Running migrations 01-05
--   2. Creating the super admin Firebase account
--   3. Inserting the super admin row in public.users (migration 01 seed block)
--
-- Replace 'SUPER_ADMIN_USER_ID' with the actual UUID from public.users.

DO $$
DECLARE
  super_admin_id UUID;
BEGIN
  SELECT user_id INTO super_admin_id
  FROM public.users
  WHERE role = 'super_admin'
  LIMIT 1;

  IF super_admin_id IS NULL THEN
    RAISE EXCEPTION 'No super_admin found in users table. Create one first.';
  END IF;

  UPDATE public.products
  SET user_id = super_admin_id
  WHERE user_id IS NULL;

  UPDATE public.purchase_invoice
  SET user_id = super_admin_id
  WHERE user_id IS NULL;

  UPDATE public.lending_order
  SET issued_by_user_id = super_admin_id
  WHERE issued_by_user_id IS NULL;

  RAISE NOTICE 'Backfill complete. Super admin id: %', super_admin_id;
END;
$$;
