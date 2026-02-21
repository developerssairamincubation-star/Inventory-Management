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
    const { product_id, lost_quantity } = body;

    if (!product_id || !lost_quantity || lost_quantity < 1) {
      return NextResponse.json(
        { error: "product_id and lost_quantity (≥1) are required" },
        { status: 400 }
      );
    }

    // 1. Get the current lending_item row for this order + product
    const { data: lendingItem, error: lendingItemError } = await supabase
      .from("lending_item")
      .select("quantity, lost_quantity")
      .eq("lend_order_id", id)
      .eq("product_id", product_id)
      .single();

    if (lendingItemError || !lendingItem) {
      return NextResponse.json(
        { error: "Lending item not found" },
        { status: 404 }
      );
    }

    if (lost_quantity > lendingItem.quantity) {
      return NextResponse.json(
        { error: `Lost quantity (${lost_quantity}) exceeds lent quantity (${lendingItem.quantity})` },
        { status: 400 }
      );
    }

    const newLentQuantity = lendingItem.quantity - lost_quantity;
    const newItemLostQty = (lendingItem.lost_quantity || 0) + lost_quantity;

    // 2. Update lending_item: reduce quantity, increment lost_quantity
    //    (quantity can reach 0 — constraint was relaxed to >= 0)
    const { error: lendingUpdateError } = await supabase
      .from("lending_item")
      .update({ quantity: newLentQuantity, lost_quantity: newItemLostQty })
      .eq("lend_order_id", id)
      .eq("product_id", product_id);

    if (lendingUpdateError) {
      console.error("Error updating lending item:", lendingUpdateError);
      return NextResponse.json({ error: lendingUpdateError.message }, { status: 500 });
    }

    // 3. Update lending_order status
    if (newLentQuantity === 0) {
      const { error: orderStatusError } = await supabase
        .from("lending_order")
        .update({ status: "LOST" })
        .eq("lending_order_id", id);

      if (orderStatusError) {
        console.error("Error updating lending order status:", orderStatusError);
        return NextResponse.json({ error: orderStatusError.message }, { status: 500 });
      }
    } else {
      const { data: lendingOrder } = await supabase
        .from("lending_order")
        .select("status")
        .eq("lending_order_id", id)
        .single();

      if (lendingOrder && (lendingOrder.status === "PENDING" || lendingOrder.status === "PARTIALLY_DAMAGED")) {
        const { error: orderStatusError } = await supabase
          .from("lending_order")
          .update({ status: "PARTIALLY_LOST" })
          .eq("lending_order_id", id);

        if (orderStatusError) {
          console.error("Error updating lending order status:", orderStatusError);
          return NextResponse.json({ error: orderStatusError.message }, { status: 500 });
        }
      }
    }

    // 3. Reduce stocks.quantity and increase stocks.lost_quantity
    const { data: stockData, error: stockFetchError } = await supabase
      .from("stocks")
      .select("quantity, lost_quantity")
      .eq("product_id", product_id)
      .single();

    if (stockFetchError || !stockData) {
      console.error("Error fetching stock:", stockFetchError);
      return NextResponse.json({ error: "Stock record not found" }, { status: 404 });
    }

    const newStockQuantity = Math.max(0, (stockData.quantity || 0) - lost_quantity);
    const newLostQuantity = (stockData.lost_quantity || 0) + lost_quantity;

    const { error: stockUpdateError } = await supabase
      .from("stocks")
      .update({
        quantity: newStockQuantity,
        lost_quantity: newLostQuantity,
      })
      .eq("product_id", product_id);

    if (stockUpdateError) {
      // If lost_quantity column doesn't exist yet, fall back to just reducing quantity
      if (stockUpdateError.code === "42703") {
        await supabase
          .from("stocks")
          .update({ quantity: newStockQuantity })
          .eq("product_id", product_id);
      } else {
        console.error("Error updating stock:", stockUpdateError);
        return NextResponse.json({ error: stockUpdateError.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      newLentQuantity,
      newStockQuantity,
      newLostQuantity,
      orderStatus: newLentQuantity === 0 ? "LOST" : "PARTIALLY_LOST",
    });
  } catch (error) {
    console.error("Error processing lost request:", error);
    return NextResponse.json(
      { error: "Failed to mark items as lost" },
      { status: 500 }
    );
  }
}
