import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseServer'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'
import { ok, fromError } from '@/lib/api/response'
import { ApiError } from '@/lib/api/errors'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const { id } = await params
    const body = await req.json()
    const supabase = getSupabaseAdmin()

    const updateData: Record<string, unknown> = {}
    if (body.name !== undefined) updateData.name = body.name
    if (body.employee_id !== undefined) updateData.employee_id = body.employee_id
    if (body.department_id !== undefined) updateData.department_id = body.department_id
    if (body.email !== undefined) updateData.email = body.email
    if (body.phone_number !== undefined) updateData.phone_number = body.phone_number

    const { data, error } = await supabase
      .from('staffs')
      .update(updateData)
      .eq('staff_id', id)
      .select('staff_id, name, employee_id, department_id, email, phone_number, departments(department_name)')
      .single()

    if (error) throw new ApiError(500, 'DATABASE_ERROR', error.message)
    return ok(data)
  } catch (error) {
    return fromError(error)
  }
}
