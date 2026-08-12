import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { lending_order, lending_item, stocks } from "@/db/schema";
import { getAuthUser, unauthorizedResponse } from "@/lib/authMiddleware";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const { id } = await params;

    const [order] = await db.select({ lending_order_id: lending_order.lending_order_id }).from(lending_order).where(and(eq(lending_order.lending_order_id, id), eq(lending_order.issued_by_user_id, user.user_id)))
    if (!order) return NextResponse.json({ error: "Lending record not found" }, { status: 404 });

    await db.transaction(async (tx) => {
      const items = await tx.select({ product_id: lending_item.product_id, quantity: lending_item.quantity }).from(lending_item).where(eq(lending_item.lend_order_id, id))

      await tx.delete(lending_item).where(eq(lending_item.lend_order_id, id))
      await tx.delete(lending_order).where(eq(lending_order.lending_order_id, id))

      const itemsToRestore = items.filter((item) => item.product_id && (item.quantity || 0) > 0)
      for (const item of itemsToRestore) {
        await tx.update(stocks).set({ quantity: sql`${stocks.quantity} + ${item.quantity}` }).where(eq(stocks.product_id, item.product_id))
      }
    })

    return NextResponse.json({ success: true });
  } catch {
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
    const { id } = await params;
    const body = await request.json();

    const [order] = await db.select({ lending_order_id: lending_order.lending_order_id }).from(lending_order).where(and(eq(lending_order.lending_order_id, id), eq(lending_order.issued_by_user_id, user.user_id)))
    if (!order) return NextResponse.json({ error: "Lending record not found" }, { status: 404 });

    const { due_date, return_date, status, mentor, quantity, original_quantity, product_id } = body;

    if (product_id !== undefined && quantity !== undefined) {
      const [currentItem] = await db.select({ quantity: lending_item.quantity }).from(lending_item).where(and(eq(lending_item.lend_order_id, id), eq(lending_item.product_id, product_id)))

      const previousOutstanding = currentItem?.quantity ?? 0;
      const nowReturning = previousOutstanding - quantity;

      await db.update(lending_item).set({ quantity }).where(and(eq(lending_item.lend_order_id, id), eq(lending_item.product_id, product_id)))

      if (nowReturning > 0) {
        await db.update(stocks).set({ quantity: sql`${stocks.quantity} + ${nowReturning}` }).where(eq(stocks.product_id, product_id))
      }

      const allItems = await db.select({ quantity: lending_item.quantity, damaged_quantity: lending_item.damaged_quantity, lost_quantity: lending_item.lost_quantity }).from(lending_item).where(eq(lending_item.lend_order_id, id))

      const totalOutstanding = allItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
      const anyDamaged = allItems.some((item) => (item.damaged_quantity || 0) > 0);
      const anyLost = allItems.some((item) => (item.lost_quantity || 0) > 0);

      let orderStatus: string;
      const orderUpdate: Partial<typeof lending_order.$inferInsert> = {};

      if (totalOutstanding > 0) {
        const [currentOrder] = await db.select({ status: lending_order.status }).from(lending_order).where(eq(lending_order.lending_order_id, id))
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

      orderUpdate.status = orderStatus as typeof lending_order.$inferInsert.status;
      await db.update(lending_order).set(orderUpdate).where(eq(lending_order.lending_order_id, id));

      return NextResponse.json({ success: true });
    }

    const orderUpdate: Partial<typeof lending_order.$inferInsert> = {};
    if (due_date !== undefined) orderUpdate.due_date = due_date;
    if (return_date !== undefined) orderUpdate.return_date = return_date;
    if (status !== undefined) orderUpdate.status = status;
    // Bug fix: this used to write `orderUpdate.mentor`, a column that
    // doesn't exist — mentor reassignment silently never persisted. The
    // real column is mentor_staff_id.
    if (mentor !== undefined) orderUpdate.mentor_staff_id = mentor;

    if (Object.keys(orderUpdate).length > 0) {
      await db.update(lending_order).set(orderUpdate).where(eq(lending_order.lending_order_id, id));
    }

    if (quantity !== undefined) {
      const itemUpdate: Partial<typeof lending_item.$inferInsert> = { quantity };
      if (original_quantity !== undefined) itemUpdate.original_quantity = original_quantity;
      await db.update(lending_item).set(itemUpdate).where(eq(lending_item.lend_order_id, id));
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to update lending record" }, { status: 500 });
  }
}
