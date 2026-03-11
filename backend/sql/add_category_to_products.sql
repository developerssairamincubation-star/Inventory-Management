-- =============================================================
-- Migration: Add category support
-- Creates the category table and adds category_id FK to products
-- Run this in your Supabase SQL editor
-- =============================================================

-- 1. Create the category table
CREATE TABLE IF NOT EXISTS public.category (
  category_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 2. Add category_id foreign key column to products table
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.category(category_id) ON DELETE SET NULL;

-- 3. Index for faster joins
CREATE INDEX IF NOT EXISTS idx_products_category_id ON public.products(category_id);

-- 4. (Optional) seed some starter categories
-- INSERT INTO public.category (category_name) VALUES
--   ('Electronics'),
--   ('Lab Equipment'),
--   ('Tools'),
--   ('Consumables'),
--   ('Others')
-- ON CONFLICT (category_name) DO NOTHING;
