-- Migration: Add user_id ownership column to purchase_invoice table
-- Each invoice belongs to one inventory user.

ALTER TABLE public.purchase_invoice
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(user_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_purchase_invoice_user_id ON public.purchase_invoice(user_id);

-- Backfill: assign all existing invoices to the super admin.
-- Replace the UUID below with the actual super admin user_id after running migration 01.
-- UPDATE public.purchase_invoice SET user_id = 'SUPER_ADMIN_USER_ID' WHERE user_id IS NULL;
