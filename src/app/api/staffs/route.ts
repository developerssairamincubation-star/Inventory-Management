import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { ApiError } from '@/lib/api/errors'
import { fromError, ok, created } from '@/lib/api/response'
import { getAuthUser, unauthorizedResponse } from "@/lib/authMiddleware";

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.trim() || ''

    let query = supabase
      .from("staffs")
      .select("staff_id, name, department_id, employee_id, email, phone_number, departments(department_name)")
      .order("name", { ascending: true });

    if (search) {
      query = query.or(`name.ilike.%${search}%,employee_id.ilike.%${search}%,email.ilike.%${search}%`)
    }

    const { data: staffs, error } = await query

    if (error) throw new ApiError(500, 'DATABASE_ERROR', error.message)

    return ok(staffs || []);
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
    const { name, employee_id, department_id, email, phone_number } = body

    if (!name || !department_id) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'name and department_id are required')
    }

    if (employee_id) {
      const { data: existing } = await supabase
        .from('staffs')
        .select('staff_id')
        .eq('employee_id', employee_id)
        .maybeSingle()

      if (existing) {
        throw new ApiError(409, 'CONFLICT', 'A staff member with this employee ID already exists')
      }
    }

    const { data, error } = await supabase
      .from('staffs')
      .insert({ name, employee_id: employee_id || null, department_id, email: email || null, phone_number: phone_number || null })
      .select('staff_id, name, employee_id, department_id, email, phone_number, departments(department_name)')
      .single()

    if (error) throw new ApiError(500, 'DATABASE_ERROR', error.message)
    return created(data)
  } catch (error) {
    return fromError(error)
  }
}
