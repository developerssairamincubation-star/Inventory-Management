import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getAuthUser, unauthorizedResponse } from "@/lib/authMiddleware";

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const supabase = getSupabaseAdmin();

    // Invoice numbers are per-user sequences
    const { data } = await supabase
      .from("purchase_invoice")
      .select("invoice_number")
      .eq("user_id", user.user_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextInvoiceNo = "INV001";

    if (data?.invoice_number) {
      const match = data.invoice_number.match(/INV(\d+)/);
      if (match) {
        const lastNumber = parseInt(match[1], 10);
        nextInvoiceNo = `INV${String(lastNumber + 1).padStart(3, '0')}`;
      }
    }

    return NextResponse.json({ invoice_no: nextInvoiceNo });
  } catch {
    return NextResponse.json({ invoice_no: "INV001" });
  }
}
