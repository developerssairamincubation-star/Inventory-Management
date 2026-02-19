-- Migration: Add damaged_quantity column to stocks table
-- Run this in your Supabase SQL editor before using the damaged items feature.

ALTER TABLE stocks
ADD COLUMN IF NOT EXISTS damaged_quantity INTEGER NOT NULL DEFAULT 0;
