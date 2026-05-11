import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getAuthUser, unauthorizedResponse } from "@/lib/authMiddleware";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const supabase = getSupabaseAdmin();
    const { id: invoiceId } = await params;

    const { data: invoice, error: invoiceError } = await supabase
      .from("purchase_invoice")
      .select("*")
      .eq("invoice_id", invoiceId)
      .eq("user_id", user.user_id)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const { data: items, error: itemsError } = await supabase
      .from("purchase_invoice_item")
      .select(`*, products (product_name)`)
      .eq("invoice_id", invoiceId);

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    return NextResponse.json({
      invoice_id: invoice.invoice_id,
      invoice_number: invoice.invoice_number,
      supplier_name: invoice.supplier_name,
      received_date: invoice.received_date,
      created_at: invoice.created_at,
      total_amount: invoice.total_amount,
      items: (items || []).map((item: any) => ({
        product_name: item.products?.product_name || item.product_name || "Unknown Product",
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        total_cost: item.total_cost,
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const supabase = getSupabaseAdmin();
    const { id: invoiceId } = await params;

    // Verify ownership before deleting
    const { data: invoice } = await supabase
      .from("purchase_invoice")
      .select("invoice_id")
      .eq("invoice_id", invoiceId)
      .eq("user_id", user.user_id)
      .single();

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const { data: items } = await supabase
      .from("purchase_invoice_item")
      .select("product_id, quantity")
      .eq("invoice_id", invoiceId);

    if (items && items.length > 0) {
      for (const item of items) {
        if (!item.product_id) continue;
        const { data: stockData } = await supabase
          .from("stocks")
          .select("quantity")
          .eq("product_id", item.product_id)
          .single();
        if (stockData) {
          await supabase
            .from("stocks")
            .update({ quantity: Math.max(0, stockData.quantity - item.quantity) })
            .eq("product_id", item.product_id);
        }
      }
    }

    await supabase.from("purchase_invoice_item").delete().eq("invoice_id", invoiceId);

    const { error } = await supabase
      .from("purchase_invoice")
      .delete()
      .eq("invoice_id", invoiceId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ message: "Invoice deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
