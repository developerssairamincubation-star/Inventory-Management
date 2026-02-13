import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();

    // Fetch the latest invoice number
    const { data, error } = await supabase
      .from("purchase_invoice")
      .select("invoice_number")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    let nextInvoiceNo = "INV001";

    if (data && data.invoice_number) {
      // Extract number from existing invoice (e.g., "INV005" -> 5)
      const match = data.invoice_number.match(/INV(\d+)/);
      if (match) {
        const lastNumber = parseInt(match[1], 10);
        const nextNumber = lastNumber + 1;
        nextInvoiceNo = `INV${String(nextNumber).padStart(3, '0')}`;
      }
    }

    return NextResponse.json({ invoice_no: nextInvoiceNo });
  } catch (error: any) {
    // If no invoices exist yet, return INV001
    return NextResponse.json({ invoice_no: "INV001" });
  }
}
