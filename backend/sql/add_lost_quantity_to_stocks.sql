-- Migration: Add lost_quantity column to stocks table
-- Run this in your Supabase SQL editor before using the mark-as-lost feature.

ALTER TABLE stocks
ADD COLUMN IF NOT EXISTS lost_quantity INTEGER NOT NULL DEFAULT 0;
