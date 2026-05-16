import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getAuthUser, unauthorizedResponse } from "@/lib/authMiddleware";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const supabase = getSupabaseAdmin();
    const { id } = await params;
    const body = await request.json();
    const { product_id, damaged_quantity } = body;

    if (!product_id || !damaged_quantity || damaged_quantity < 1) {
      return NextResponse.json({ error: "product_id and damaged_quantity (≥1) are required" }, { status: 400 });
    }

    // Verify order ownership
    const { data: order } = await supabase
      .from("lending_order")
      .select("lending_order_id")
      .eq("lending_order_id", id)
      .eq("issued_by_user_id", user.user_id)
      .single();

    if (!order) return NextResponse.json({ error: "Lending record not found" }, { status: 404 });

    const { data: lendingItem, error: lendingItemError } = await supabase
      .from("lending_item")
      .select("quantity, damaged_quantity")
      .eq("lend_order_id", id)
      .eq("product_id", product_id)
      .single();

    if (lendingItemError || !lendingItem) {
      return NextResponse.json({ error: "Lending item not found" }, { status: 404 });
    }

    if (damaged_quantity > lendingItem.quantity) {
      return NextResponse.json({ error: `Damaged quantity (${damaged_quantity}) exceeds lent quantity (${lendingItem.quantity})` }, { status: 400 });
    }

    const newLentQuantity = lendingItem.quantity - damaged_quantity;
    const newItemDamagedQty = (lendingItem.damaged_quantity || 0) + damaged_quantity;

    await supabase
      .from("lending_item")
      .update({ quantity: newLentQuantity, damaged_quantity: newItemDamagedQty })
      .eq("lend_order_id", id)
      .eq("product_id", product_id);

    if (newLentQuantity === 0) {
      await supabase.from("lending_order").update({ status: "DAMAGED" }).eq("lending_order_id", id);
    } else {
      const { data: lendingOrder } = await supabase.from("lending_order").select("status").eq("lending_order_id", id).single();
      if (lendingOrder && lendingOrder.status === "PENDING") {
        await supabase.from("lending_order").update({ status: "PARTIALLY_DAMAGED" }).eq("lending_order_id", id);
      }
    }

    const { data: stockData, error: stockFetchError } = await supabase
      .from("stocks")
      .select("quantity, damaged_quantity")
      .eq("product_id", product_id)
      .single();

    if (stockFetchError || !stockData) {
      return NextResponse.json({ error: "Stock record not found" }, { status: 404 });
    }

    const newStockQuantity = Math.max(0, (stockData.quantity || 0) - damaged_quantity);
    const newDamagedQuantity = (stockData.damaged_quantity || 0) + damaged_quantity;

    const { error: stockUpdateError } = await supabase
      .from("stocks")
      .update({ quantity: newStockQuantity, damaged_quantity: newDamagedQuantity })
      .eq("product_id", product_id);

    if (stockUpdateError) {
      return NextResponse.json({ error: stockUpdateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      newLentQuantity,
      newItemDamagedQty,
      newStockQuantity,
      newDamagedQuantity,
      orderStatus: newLentQuantity === 0 ? "DAMAGED" : "PARTIALLY_DAMAGED",
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to mark items as damaged" }, { status: 500 });
  }
}
