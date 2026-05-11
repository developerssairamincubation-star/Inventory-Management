import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getAuthUser, unauthorizedResponse } from "@/lib/authMiddleware";

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const supabase = getSupabaseAdmin();

    const { data: invoicesData, error: invoicesError } = await supabase
      .from("purchase_invoice")
      .select("*")
      .eq("user_id", user.user_id)
      .order("created_at", { ascending: false });

    if (invoicesError) {
      return NextResponse.json({ error: invoicesError.message }, { status: 500 });
    }

    if (!invoicesData || invoicesData.length === 0) {
      return NextResponse.json({ invoices: [] });
    }

    const invoiceIds = invoicesData.map((inv: any) => inv.invoice_id);

    const { data: itemsData, error: itemsError } = await supabase
      .from("purchase_invoice_item")
      .select("*")
      .in("invoice_id", invoiceIds);

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    const itemsMap = new Map<string, any[]>();
    (itemsData || []).forEach((item: any) => {
      if (!itemsMap.has(item.invoice_id)) {
        itemsMap.set(item.invoice_id, []);
      }
      itemsMap.get(item.invoice_id)!.push(item);
    });

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
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const supabase = getSupabaseAdmin();
    const body = await request.json();

    const { invoice_number, supplier_name, received_date, items } = body;

    if (!invoice_number || !supplier_name || !received_date || !items || items.length === 0) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const normalisedItems = items.map((item: any) => ({
      product_id: item.product_id || null,
      product_name: String(item.product_name || "").trim(),
      quantity: Number(item.quantity) || 0,
      unit_cost: Number(item.unit_cost) || 0,
      total_cost: Number(item.total_cost) || 0,
    }));

    if (normalisedItems.some((item: any) => !item.product_name || item.quantity <= 0 || item.unit_cost < 0 || item.total_cost < 0)) {
      return NextResponse.json({ error: "Each invoice item must include a product name, quantity and cost" }, { status: 400 });
    }

    const total_amount = normalisedItems.reduce((sum: number, item: any) => sum + item.total_cost, 0);
    const currentDate = new Date().toISOString();

    const { data: invoice, error: invoiceError } = await supabase
      .from("purchase_invoice")
      .insert({
        invoice_number,
        supplier_name,
        received_date,
        total_amount,
        user_id: user.user_id,
        created_at: currentDate,
        updated_at: currentDate,
      })
      .select()
      .single();

    if (invoiceError) {
      return NextResponse.json({ error: invoiceError.message }, { status: 500 });
    }

    const invoiceItems = normalisedItems.map((item: any) => ({
      invoice_id: invoice.invoice_id,
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: item.quantity,
      unit_cost: item.unit_cost,
      total_cost: item.total_cost,
    }));

    const { error: itemsError } = await supabase
      .from("purchase_invoice_item")
      .insert(invoiceItems);

    if (itemsError) {
      await supabase.from("purchase_invoice").delete().eq("invoice_id", invoice.invoice_id);
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    for (const item of normalisedItems) {
      if (!item.product_id) continue;

      const { data: stockData } = await supabase
        .from("stocks")
        .select("quantity")
        .eq("product_id", item.product_id)
        .single();

      if (stockData) {
        await supabase
          .from("stocks")
          .update({ quantity: stockData.quantity + item.quantity, updated_at: currentDate })
          .eq("product_id", item.product_id);
      } else {
        await supabase
          .from("stocks")
          .insert({ product_id: item.product_id, quantity: item.quantity, created_at: currentDate, updated_at: currentDate });
      }
    }

    return NextResponse.json({ message: "Invoice created successfully", invoice });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
