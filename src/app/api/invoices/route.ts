import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();

    // Fetch all invoices
    const { data: invoicesData, error: invoicesError } = await supabase
      .from("purchase_invoice")
      .select("*")
      .order("created_at", { ascending: false });

    if (invoicesError) {
      return NextResponse.json({ error: invoicesError.message }, { status: 500 });
    }

    if (!invoicesData || invoicesData.length === 0) {
      return NextResponse.json({ invoices: [] });
    }

    const invoiceIds = invoicesData.map((inv: any) => inv.invoice_id);

    // Fetch invoice items for all invoices
    const { data: itemsData, error: itemsError } = await supabase
      .from("purchase_invoice_item")
      .select("*")
      .in("invoice_id", invoiceIds);

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    // Build items map
    const itemsMap = new Map<string, any[]>();
    (itemsData || []).forEach((item: any) => {
      if (!itemsMap.has(item.invoice_id)) {
        itemsMap.set(item.invoice_id, []);
      }
      itemsMap.get(item.invoice_id)!.push(item);
    });

    // Build invoice response with items count and total
    const invoices = invoicesData.map((invoice: any) => {
      const items = itemsMap.get(invoice.invoice_id) || [];
      
      return {
        invoice_id: invoice.invoice_id,
        invoice_number: invoice.invoice_number,
        supplier_name: invoice.supplier_name,
        received_date: invoice.received_date,
        items_count: items.length,
        total_amount: invoice.total_amount || 0,
      };
    });

    return NextResponse.json({ invoices });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await request.json();

    const { invoice_number, supplier_name, received_date, items } = body;

    if (!invoice_number || !supplier_name || !received_date || !items || items.length === 0) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Calculate total amount
    const total_amount = items.reduce((sum: number, item: any) => sum + (item.total_cost || 0), 0);

    // Get current timestamp for created_at and updated_at
    const currentDate = new Date().toISOString();

    // Create invoice with total_amount
    const { data: invoice, error: invoiceError } = await supabase
      .from("purchase_invoice")
      .insert({
        invoice_number,
        supplier_name,
        received_date,
        total_amount,
        created_at: currentDate,
        updated_at: currentDate,
      })
      .select()
      .single();

    if (invoiceError) {
      return NextResponse.json({ error: invoiceError.message }, { status: 500 });
    }

    // Create invoice items
    const invoiceItems = items.map((item: any) => ({
      invoice_id: invoice.invoice_id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_cost: item.unit_cost,
      total_cost: item.total_cost,
    }));

    const { error: itemsError } = await supabase
      .from("purchase_invoice_item")
      .insert(invoiceItems);

    if (itemsError) {
      // Rollback: delete the invoice if items insertion fails
      await supabase.from("purchase_invoice").delete().eq("invoice_id", invoice.invoice_id);
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    // Update stock quantities
    for (const item of items) {
      const { data: stockData } = await supabase
        .from("stocks")
        .select("quantity")
        .eq("product_id", item.product_id)
        .single();

      if (stockData) {
        // Update existing stock
        await supabase
          .from("stocks")
          .update({ 
            quantity: stockData.quantity + item.quantity,
            updated_at: currentDate 
          })
          .eq("product_id", item.product_id);
      } else {
        // Create new stock entry
        await supabase
          .from("stocks")
          .insert({
            product_id: item.product_id,
            quantity: item.quantity,
            created_at: currentDate,
            updated_at: currentDate,
          });
      }
    }

    return NextResponse.json({ message: "Invoice created successfully", invoice });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
