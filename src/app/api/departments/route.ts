import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { ApiError } from '@/lib/api/errors'
import { created, fromError, ok } from '@/lib/api/response'
import { forbiddenResponse, getAuthUser, unauthorizedResponse } from "@/lib/authMiddleware";

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const supabase = getSupabaseAdmin();
    const { data: departments, error } = await supabase
      .from("departments")
      .select("department_id, department_name")
      .order("department_name", { ascending: true });

    if (error) throw new ApiError(500, 'DATABASE_ERROR', error.message)

    return ok(departments || []);
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
    const department_name = (body?.department_name ?? '').trim()

    if (!department_name) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'department_name is required')
    }

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('departments')
      .insert({ department_name })
      .select('department_id, department_name')
      .single()

    if (error) throw new ApiError(500, 'DATABASE_ERROR', error.message)

    return created(data)
  } catch (error) {
    return fromError(error)
  }
}
