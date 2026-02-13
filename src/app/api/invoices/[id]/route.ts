import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const { id: invoiceId } = await params;

    // Fetch invoice details
    const { data: invoice, error: invoiceError } = await supabase
      .from("purchase_invoice")
      .select("*")
      .eq("invoice_id", invoiceId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Fetch invoice items with product names
    const { data: items, error: itemsError } = await supabase
      .from("purchase_invoice_item")
      .select(`
        *,
        products (
          product_name
        )
      `)
      .eq("invoice_id", invoiceId);

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    // Format the response
    const invoiceDetail = {
      invoice_id: invoice.invoice_id,
      invoice_number: invoice.invoice_number,
      supplier_name: invoice.supplier_name,
      received_date: invoice.received_date,
      created_at: invoice.created_at,
      total_amount: invoice.total_amount,
      items: (items || []).map((item: any) => ({
        product_name: item.products?.product_name || "Unknown Product",
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        total_cost: item.total_cost,
      })),
    };

    return NextResponse.json(invoiceDetail);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const { id: invoiceId } = await params;

    // First, get all items from this invoice to update stock
    const { data: items, error: itemsError } = await supabase
      .from("purchase_invoice_item")
      .select("product_id, quantity")
      .eq("invoice_id", invoiceId);

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    // Update stock quantities (subtract the quantities that were added)
    if (items && items.length > 0) {
      for (const item of items) {
        const { data: stockData } = await supabase
          .from("stocks")
          .select("quantity")
          .eq("product_id", item.product_id)
          .single();

        if (stockData) {
          const newQuantity = Math.max(0, stockData.quantity - item.quantity);
          await supabase
            .from("stocks")
            .update({ 
              quantity: newQuantity,
              updated_date: new Date().toISOString()
            })
            .eq("product_id", item.product_id);
        }
      }
    }

    // Delete invoice items
    const { error: deleteItemsError } = await supabase
      .from("purchase_invoice_item")
      .delete()
      .eq("invoice_id", invoiceId);

    if (deleteItemsError) {
      return NextResponse.json({ error: deleteItemsError.message }, { status: 500 });
    }

    // Delete invoice
    const { error: deleteInvoiceError } = await supabase
      .from("purchase_invoice")
      .delete()
      .eq("invoice_id", invoiceId);

    if (deleteInvoiceError) {
      return NextResponse.json({ error: deleteInvoiceError.message }, { status: 500 });
    }

    return NextResponse.json({ message: "Invoice deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
