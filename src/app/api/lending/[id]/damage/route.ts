import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const { id } = await params;
    const body = await request.json();
    const { product_id, damaged_quantity } = body;

    if (!product_id || !damaged_quantity || damaged_quantity < 1) {
      return NextResponse.json(
        { error: "product_id and damaged_quantity (≥1) are required" },
        { status: 400 }
      );
    }

    // 1. Get the current lending_item quantity for this order + product
    const { data: lendingItem, error: lendingItemError } = await supabase
      .from("lending_item")
      .select("quantity")
      .eq("lend_order_id", id)
      .eq("product_id", product_id)
      .single();

    if (lendingItemError || !lendingItem) {
      return NextResponse.json(
        { error: "Lending item not found" },
        { status: 404 }
      );
    }

    if (damaged_quantity > lendingItem.quantity) {
      return NextResponse.json(
        { error: `Damaged quantity (${damaged_quantity}) exceeds lent quantity (${lendingItem.quantity})` },
        { status: 400 }
      );
    }

    const newLentQuantity = lendingItem.quantity - damaged_quantity;

    // 2. Reduce lending_item.quantity by damaged_quantity
    const { error: lendingUpdateError } = await supabase
      .from("lending_item")
      .update({ quantity: newLentQuantity })
      .eq("lend_order_id", id)
      .eq("product_id", product_id);

    if (lendingUpdateError) {
      console.error("Error updating lending item:", lendingUpdateError);
      return NextResponse.json({ error: lendingUpdateError.message }, { status: 500 });
    }

    // 3. Reduce stocks.quantity and increase stocks.damaged_quantity
    const { data: stockData, error: stockFetchError } = await supabase
      .from("stocks")
      .select("quantity, damaged_quantity")
      .eq("product_id", product_id)
      .single();

    if (stockFetchError || !stockData) {
      console.error("Error fetching stock:", stockFetchError);
      return NextResponse.json({ error: "Stock record not found" }, { status: 404 });
    }

    const newStockQuantity = Math.max(0, (stockData.quantity || 0) - damaged_quantity);
    const newDamagedQuantity = (stockData.damaged_quantity || 0) + damaged_quantity;

    const { error: stockUpdateError } = await supabase
      .from("stocks")
      .update({
        quantity: newStockQuantity,
        damaged_quantity: newDamagedQuantity,
      })
      .eq("product_id", product_id);

    if (stockUpdateError) {
      console.error("Error updating stock:", stockUpdateError);
      return NextResponse.json({ error: stockUpdateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      newLentQuantity,
      newStockQuantity,
      newDamagedQuantity,
    });
  } catch (error) {
    console.error("Error processing damage request:", error);
    return NextResponse.json(
      { error: "Failed to mark items as damaged" },
      { status: 500 }
    );
  }
}
