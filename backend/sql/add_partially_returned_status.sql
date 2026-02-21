-- Migration: Add PARTIALLY_RETURNED lending_order_status enum value
-- Run this in your Supabase SQL editor.

ALTER TYPE lending_order_status ADD VALUE IF NOT EXISTS 'PARTIALLY_RETURNED';
