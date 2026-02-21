import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const { id } = await params;

    // Delete lending items first (foreign key constraint)
    const { error: itemError } = await supabase
      .from("lending_item")
      .delete()
      .eq("lend_order_id", id);

    if (itemError) {
      console.error("Error deleting lending items:", itemError);
      return NextResponse.json({ error: itemError.message }, { status: 500 });
    }

    // Delete lending order
    const { error: orderError } = await supabase
      .from("lending_order")
      .delete()
      .eq("lending_order_id", id);

    if (orderError) {
      console.error("Error deleting lending order:", orderError);
      return NextResponse.json({ error: orderError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting lending record:", error);
    return NextResponse.json(
      { error: "Failed to delete lending record" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const { id } = await params;
    const body = await request.json();

    const {
      due_date,
      return_date,
      status,
      mentor,
      quantity,
      product_id,
    } = body;

    // Per-item return: product_id present → update only that item's quantity,
    // then recompute the correct order-level status from all items.
    if (product_id !== undefined && quantity !== undefined) {
      const { error: itemError } = await supabase
        .from("lending_item")
        .update({ quantity })
        .eq("lend_order_id", id)
        .eq("product_id", product_id);

      if (itemError) {
        console.error("Error updating lending item:", itemError);
        return NextResponse.json({ error: itemError.message }, { status: 500 });
      }

      // Re-fetch all items for this order to compute correct order-level status
      const { data: allItems, error: fetchError } = await supabase
        .from("lending_item")
        .select("quantity, damaged_quantity, lost_quantity")
        .eq("lend_order_id", id);

      if (fetchError) {
        console.error("Error fetching lending items:", fetchError);
        return NextResponse.json({ error: fetchError.message }, { status: 500 });
      }

      const totalOutstanding = (allItems || []).reduce(
        (sum: number, item: any) => sum + (item.quantity || 0), 0
      );
      const anyDamaged = (allItems || []).some((item: any) => (item.damaged_quantity || 0) > 0);
      const anyLost = (allItems || []).some((item: any) => (item.lost_quantity || 0) > 0);

      let orderStatus: string;
      const orderUpdate: any = {};

      if (totalOutstanding > 0) {
        // Some items still outstanding — preserve existing damage/lost context
        const { data: currentOrder } = await supabase
          .from("lending_order")
          .select("status")
          .eq("lending_order_id", id)
          .single();
        const curStatus = currentOrder?.status || "PENDING";
        if (curStatus === "PARTIALLY_DAMAGED" || curStatus === "DAMAGED") {
          orderStatus = "PARTIALLY_DAMAGED";
        } else if (curStatus === "PARTIALLY_LOST") {
          orderStatus = "PARTIALLY_LOST";
        } else {
          orderStatus = "PARTIALLY_RETURNED";
        }
      } else {
        // All items fully accounted for — final return
        if (anyDamaged) {
          orderStatus = "RETURNED_DAMAGED";
        } else if (anyLost) {
          orderStatus = "RETURNED_LOST";
        } else {
          orderStatus = "RETURNED";
        }
        if (return_date) orderUpdate.return_date = return_date;
      }

      orderUpdate.status = orderStatus;
      const { error: orderStatusError } = await supabase
        .from("lending_order")
        .update(orderUpdate)
        .eq("lending_order_id", id);

      if (orderStatusError) {
        console.error("Error updating lending order status:", orderStatusError);
        return NextResponse.json({ error: orderStatusError.message }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    // Generic order-level update (due_date, mentor, status, return_date)
    const orderUpdate: any = {};
    if (due_date !== undefined) orderUpdate.due_date = due_date;
    if (return_date !== undefined) orderUpdate.return_date = return_date;
    if (status !== undefined) orderUpdate.status = status;
    if (mentor !== undefined) orderUpdate.mentor = mentor;

    if (Object.keys(orderUpdate).length > 0) {
      const { error: orderError } = await supabase
        .from("lending_order")
        .update(orderUpdate)
        .eq("lending_order_id", id);

      if (orderError) {
        console.error("Error updating lending order:", orderError);
        return NextResponse.json({ error: orderError.message }, { status: 500 });
      }
    }

    // Legacy: update all items' quantity when no product_id is given
    if (quantity !== undefined) {
      const { error: itemError } = await supabase
        .from("lending_item")
        .update({ quantity })
        .eq("lend_order_id", id);

      if (itemError) {
        console.error("Error updating lending item:", itemError);
        return NextResponse.json({ error: itemError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating lending record:", error);
    return NextResponse.json(
      { error: "Failed to update lending record" },
      { status: 500 }
    );
  }
}
