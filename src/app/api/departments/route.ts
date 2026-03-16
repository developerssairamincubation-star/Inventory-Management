import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { ApiError } from '@/lib/api/errors'
import { fromError, ok } from '@/lib/api/response'

export async function GET() {
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
