import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseServer'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'
import { ok, created, fromError } from '@/lib/api/response'
import { ApiError } from '@/lib/api/errors'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const supabase = getSupabaseAdmin()
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.trim() || ''

    let query = supabase
      .from('students')
      .select('student_id, name, student_number, department_id, email, phone_number, departments(department_name)')
      .order('name', { ascending: true })

    if (search) {
      query = query.or(`name.ilike.%${search}%,student_number.ilike.%${search}%,email.ilike.%${search}%`)
    }

    const { data, error } = await query

    if (error) throw new ApiError(500, 'DATABASE_ERROR', error.message)
    return ok(data || [])
  } catch (error) {
    return fromError(error)
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const supabase = getSupabaseAdmin()
    const body = await req.json()
    const { name, student_number, department_id, email, phone_number } = body

    if (!name || !department_id) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'name and department_id are required')
    }

    // Check for duplicate by student_number if provided
    if (student_number) {
      const { data: existing } = await supabase
        .from('students')
        .select('student_id')
        .eq('student_number', student_number)
        .maybeSingle()

      if (existing) {
        throw new ApiError(409, 'CONFLICT', 'A student with this student number already exists')
      }
    }

    const { data, error } = await supabase
      .from('students')
      .insert({ name, student_number: student_number || null, department_id, email: email || null, phone_number: phone_number || null })
      .select('student_id, name, student_number, department_id, email, phone_number, departments(department_name)')
      .single()

    if (error) throw new ApiError(500, 'DATABASE_ERROR', error.message)
    return created(data)
  } catch (error) {
    return fromError(error)
  }
}
