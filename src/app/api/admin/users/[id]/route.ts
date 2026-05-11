import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseServer'
import { updateFirebaseUser } from '@/lib/firebaseAdmin'
import { getAuthUser, unauthorizedResponse, forbiddenResponse } from '@/lib/authMiddleware'
import { ok, fromError } from '@/lib/api/response'
import { ApiError } from '@/lib/api/errors'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()
  if (user.role !== 'super_admin') return forbiddenResponse()

  try {
    const { id } = await params
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('users')
      .select('user_id, email, full_name, role, is_active, created_at')
      .eq('user_id', id)
      .single()

    if (error || !data) throw new ApiError(404, 'NOT_FOUND', 'User not found')
    return ok(data)
  } catch (error) {
    return fromError(error)
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()
  if (user.role !== 'super_admin') return forbiddenResponse()

  try {
    const { id } = await params
    const body = await req.json()
    const { full_name, role, is_active } = body

    const supabase = getSupabaseAdmin()

    // Fetch target user for firebase_uid
    const { data: target, error: fetchError } = await supabase
      .from('users')
      .select('firebase_uid, role')
      .eq('user_id', id)
      .single()

    if (fetchError || !target) throw new ApiError(404, 'NOT_FOUND', 'User not found')

    // Prevent demoting the only super admin
    if (role === 'user' && target.role === 'super_admin') {
      const { count } = await supabase
        .from('users')
        .select('user_id', { count: 'exact', head: true })
        .eq('role', 'super_admin')
      if ((count || 0) <= 1) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Cannot demote the only super admin')
      }
    }

    const updateData: Record<string, unknown> = {}
    if (full_name !== undefined) updateData.full_name = full_name
    if (role !== undefined) updateData.role = role
    if (is_active !== undefined) updateData.is_active = is_active

    const { data: updated, error: updateError } = await supabase
      .from('users')
      .update(updateData)
      .eq('user_id', id)
      .select('user_id, email, full_name, role, is_active, created_at')
      .single()

    if (updateError) throw new ApiError(500, 'DATABASE_ERROR', updateError.message)

    // Sync display name to Firebase if changed
    if (full_name !== undefined && target.firebase_uid) {
      try {
        await updateFirebaseUser(target.firebase_uid, { displayName: full_name })
      } catch { /* non-critical */ }
    }

    // Disable/enable Firebase account if is_active changed
    if (is_active !== undefined && target.firebase_uid) {
      try {
        await updateFirebaseUser(target.firebase_uid, { disabled: !is_active })
      } catch { /* non-critical */ }
    }

    return ok(updated)
  } catch (error) {
    return fromError(error)
  }
}
