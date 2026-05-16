-- Migration: Add user_id ownership column to products table
-- Each product belongs to one inventory user; products are invisible to other users.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(user_id) ON DELETE CASCADE;

-- Index for filtered product queries
CREATE INDEX IF NOT EXISTS idx_products_user_id ON public.products(user_id);

-- Backfill: assign all existing products to the super admin.
-- Replace the UUID below with the actual super admin user_id after running migration 01.
-- UPDATE public.products SET user_id = 'SUPER_ADMIN_USER_ID' WHERE user_id IS NULL;
