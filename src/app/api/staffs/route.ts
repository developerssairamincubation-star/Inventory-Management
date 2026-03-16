import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { ApiError } from '@/lib/api/errors'
import { fromError, ok } from '@/lib/api/response'

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    const { data: staffs, error } = await supabase
      .from("staffs")
      .select("staff_id, name")
      .order("name", { ascending: true });

    if (error) throw new ApiError(500, 'DATABASE_ERROR', error.message)

    return ok(staffs || []);
  } catch (error) {
    return fromError(error)
  }
}
