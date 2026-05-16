-- Migration: Extend existing users table for Firebase-based multi-user auth
-- Run in Supabase SQL editor BEFORE any other migration in this set.

-- 1. Add firebase_uid (links Supabase user row to Firebase Auth account)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS firebase_uid TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS role         TEXT NOT NULL DEFAULT 'user'
                                         CHECK (role IN ('super_admin', 'user')),
  ADD COLUMN IF NOT EXISTS is_active    BOOLEAN NOT NULL DEFAULT true;

-- 2. Index for fast token lookups
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON public.users(firebase_uid);

-- 3. Seed the first super admin (fill in real values after creating the Firebase account)
-- INSERT INTO public.users (firebase_uid, email, full_name, role)
-- VALUES ('FIREBASE_UID_HERE', 'admin@example.com', 'System Administrator', 'super_admin');
