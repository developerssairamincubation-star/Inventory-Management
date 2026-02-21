-- Migration: Add new lending_order_status enum values
-- Run this in your Supabase SQL editor.

ALTER TYPE lending_order_status ADD VALUE IF NOT EXISTS 'PARTIALLY_DAMAGED';
ALTER TYPE lending_order_status ADD VALUE IF NOT EXISTS 'PARTIALLY_LOST';
ALTER TYPE lending_order_status ADD VALUE IF NOT EXISTS 'RETURNED_DAMAGED';
ALTER TYPE lending_order_status ADD VALUE IF NOT EXISTS 'RETURNED_LOST';
ALTER TYPE lending_order_status ADD VALUE IF NOT EXISTS 'DAMAGED';
ALTER TYPE lending_order_status ADD VALUE IF NOT EXISTS 'LOST';
