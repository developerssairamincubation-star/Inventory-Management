import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = getSupabaseAdmin();
    const id = params.id;

    // Delete lending items first (foreign key constraint)
    const { error: itemError } = await supabase
      .from("lending_item")
      .delete()
      .eq("order_id", id);

    if (itemError) {
      console.error("Error deleting lending items:", itemError);
      return NextResponse.json({ error: itemError.message }, { status: 500 });
    }

    // Delete lending order
    const { error: orderError } = await supabase
      .from("lending_order")
      .delete()
      .eq("id", id);

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
  { params }: { params: { id: string } }
) {
  try {
    const supabase = getSupabaseAdmin();
    const id = params.id;
    const body = await request.json();

    const {
      due_date,
      return_date,
      status,
      mentor,
      quantity,
    } = body;

    // Update lending order
    const orderUpdate: any = {};
    if (due_date !== undefined) orderUpdate.due_date = due_date;
    if (return_date !== undefined) orderUpdate.return_date = return_date;
    if (status !== undefined) orderUpdate.status = status;
    if (mentor !== undefined) orderUpdate.mentor = mentor;

    const { error: orderError } = await supabase
      .from("lending_order")
      .update(orderUpdate)
      .eq("id", id);

    if (orderError) {
      console.error("Error updating lending order:", orderError);
      return NextResponse.json({ error: orderError.message }, { status: 500 });
    }

    // Update quantity if provided
    if (quantity !== undefined) {
      const { error: itemError } = await supabase
        .from("lending_item")
        .update({ quantity })
        .eq("order_id", id);

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
