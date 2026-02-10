import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();

    const { data: staffs, error } = await supabase
      .from("staffs")
      .select("staff_id, name")
      .order("name", { ascending: true });

    if (error) {
      console.error("Database error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(staffs || []);
  } catch (error) {
    console.error("Error fetching staffs:", error);
    return NextResponse.json(
      { error: "Failed to fetch staffs" },
      { status: 500 }
    );
  }
}
