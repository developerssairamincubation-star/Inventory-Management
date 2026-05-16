import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getAuthUser, unauthorizedResponse } from "@/lib/authMiddleware";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const supabase = getSupabaseAdmin();
    const { id } = await params;

    // Verify ownership
    const { data: order } = await supabase
      .from("lending_order")
      .select("lending_order_id")
      .eq("lending_order_id", id)
      .eq("issued_by_user_id", user.user_id)
      .single();

    if (!order) return NextResponse.json({ error: "Lending record not found" }, { status: 404 });

    const { data: lendingItems } = await supabase
      .from("lending_item")
      .select("product_id, quantity")
      .eq("lend_order_id", id);

    await supabase.from("lending_item").delete().eq("lend_order_id", id);
    await supabase.from("lending_order").delete().eq("lending_order_id", id);

    const itemsToRestore = (lendingItems || []).filter(
      (item: any) => item.product_id && (item.quantity || 0) > 0
    );

    for (const item of itemsToRestore) {
      const { data: currentStock } = await supabase
        .from("stocks")
        .select("quantity")
        .eq("product_id", item.product_id)
        .single();

      if (currentStock) {
        await supabase
          .from("stocks")
          .update({ quantity: (currentStock?.quantity || 0) + (item.quantity || 0) })
          .eq("product_id", item.product_id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to delete lending record" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const supabase = getSupabaseAdmin();
    const { id } = await params;
    const body = await request.json();

    // Verify ownership
    const { data: order } = await supabase
      .from("lending_order")
      .select("lending_order_id")
      .eq("lending_order_id", id)
      .eq("issued_by_user_id", user.user_id)
      .single();

    if (!order) return NextResponse.json({ error: "Lending record not found" }, { status: 404 });

    const { due_date, return_date, status, mentor, quantity, original_quantity, product_id } = body;

    if (product_id !== undefined && quantity !== undefined) {
      const { data: currentItem } = await supabase
        .from("lending_item")
        .select("quantity")
        .eq("lend_order_id", id)
        .eq("product_id", product_id)
        .single();

      const previousOutstanding = currentItem?.quantity ?? 0;
      const nowReturning = previousOutstanding - quantity;

      const { error: itemError } = await supabase
        .from("lending_item")
        .update({ quantity })
        .eq("lend_order_id", id)
        .eq("product_id", product_id);

      if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });

      if (nowReturning > 0) {
        const { data: currentStock } = await supabase.from("stocks").select("quantity").eq("product_id", product_id).single();
        if (currentStock) {
          await supabase.from("stocks").update({ quantity: (currentStock.quantity || 0) + nowReturning }).eq("product_id", product_id);
        }
      }

      const { data: allItems } = await supabase
        .from("lending_item")
        .select("quantity, damaged_quantity, lost_quantity")
        .eq("lend_order_id", id);

      const totalOutstanding = (allItems || []).reduce((sum: number, item: any) => sum + (item.quantity || 0), 0);
      const anyDamaged = (allItems || []).some((item: any) => (item.damaged_quantity || 0) > 0);
      const anyLost = (allItems || []).some((item: any) => (item.lost_quantity || 0) > 0);

      let orderStatus: string;
      const orderUpdate: any = {};

      if (totalOutstanding > 0) {
        const { data: currentOrder } = await supabase.from("lending_order").select("status").eq("lending_order_id", id).single();
        const curStatus = currentOrder?.status || "PENDING";
        if (curStatus === "PARTIALLY_DAMAGED" || curStatus === "DAMAGED") orderStatus = "PARTIALLY_DAMAGED";
        else if (curStatus === "PARTIALLY_LOST") orderStatus = "PARTIALLY_LOST";
        else orderStatus = "PARTIALLY_RETURNED";
      } else {
        if (anyDamaged) orderStatus = "RETURNED_DAMAGED";
        else if (anyLost) orderStatus = "RETURNED_LOST";
        else orderStatus = "RETURNED";
        if (return_date) orderUpdate.return_date = return_date;
      }

      orderUpdate.status = orderStatus;
      await supabase.from("lending_order").update(orderUpdate).eq("lending_order_id", id);

      return NextResponse.json({ success: true });
    }

    const orderUpdate: any = {};
    if (due_date !== undefined) orderUpdate.due_date = due_date;
    if (return_date !== undefined) orderUpdate.return_date = return_date;
    if (status !== undefined) orderUpdate.status = status;
    if (mentor !== undefined) orderUpdate.mentor = mentor;

    if (Object.keys(orderUpdate).length > 0) {
      await supabase.from("lending_order").update(orderUpdate).eq("lending_order_id", id);
    }

    if (quantity !== undefined) {
      const itemUpdate: any = { quantity };
      if (original_quantity !== undefined) itemUpdate.original_quantity = original_quantity;
      await supabase.from("lending_item").update(itemUpdate).eq("lend_order_id", id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to update lending record" }, { status: 500 });
  }
}
