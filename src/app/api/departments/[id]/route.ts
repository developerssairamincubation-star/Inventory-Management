import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseServer'
import { ApiError } from '@/lib/api/errors'
import { fromError, ok } from '@/lib/api/response'
import { forbiddenResponse, getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'

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
    const department_name = (body?.department_name ?? '').trim()

    if (!department_name) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'department_name is required')
    }

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('departments')
      .update({ department_name })
      .eq('department_id', id)
      .select('department_id, department_name')
      .single()

    if (error || !data) {
      throw new ApiError(404, 'NOT_FOUND', 'Department not found')
    }

    return ok(data)
  } catch (error) {
    return fromError(error)
  }
}

export async function DELETE(
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
      .from('departments')
      .delete()
      .eq('department_id', id)
      .select('department_id')
      .single()

    if (error || !data) {
      throw new ApiError(404, 'NOT_FOUND', 'Department not found or cannot be deleted')
    }

    return ok({ success: true })
  } catch (error) {
    return fromError(error)
  }
}
