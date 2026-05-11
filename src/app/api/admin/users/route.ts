import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseServer'
import { createFirebaseUser } from '@/lib/firebaseAdmin'
import { getAuthUser, unauthorizedResponse, forbiddenResponse } from '@/lib/authMiddleware'
import { ok, created, fromError } from '@/lib/api/response'
import { ApiError } from '@/lib/api/errors'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()
  if (user.role !== 'super_admin') return forbiddenResponse()

  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('users')
      .select('user_id, email, full_name, role, is_active, created_at')
      .order('created_at', { ascending: true })

    if (error) throw new ApiError(500, 'DATABASE_ERROR', error.message)
    return ok(data || [])
  } catch (error) {
    return fromError(error)
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()
  if (user.role !== 'super_admin') return forbiddenResponse()

  try {
    const body = await req.json()
    const { email, full_name, password, role = 'user' } = body

    if (!email || !full_name || !password) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'email, full_name, and password are required')
    }
    if (!['super_admin', 'user'].includes(role)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'role must be super_admin or user')
    }

    // 1. Create Firebase Auth account
    const firebaseUser = await createFirebaseUser(email, password, full_name)

    // 2. Insert into Supabase users table
    const supabase = getSupabaseAdmin()
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        firebase_uid: firebaseUser.uid,
        email,
        full_name,
        role,
        is_active: true,
        // password_hash not used — we use Firebase Auth
        password_hash: 'firebase_managed',
      })
      .select('user_id, email, full_name, role, is_active, created_at')
      .single()

    if (error) {
      // Attempt to rollback Firebase user creation
      try {
        const { deleteFirebaseUser } = await import('@/lib/firebaseAdmin')
        await deleteFirebaseUser(firebaseUser.uid)
      } catch { /* best-effort rollback */ }
      throw new ApiError(500, 'DATABASE_ERROR', error.message)
    }

    return created(newUser)
  } catch (error) {
    return fromError(error)
  }
}
