import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { lending_order, lending_item, stocks } from "@/db/schema";
import { getAuthUser, unauthorizedResponse } from "@/lib/authMiddleware";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const { id } = await params;
    const body = await request.json();
    const { product_id, lost_quantity } = body;

    if (!product_id || !lost_quantity || lost_quantity < 1) {
      return NextResponse.json({ error: "product_id and lost_quantity (≥1) are required" }, { status: 400 });
    }

    const [order] = await db.select({ lending_order_id: lending_order.lending_order_id }).from(lending_order).where(and(eq(lending_order.lending_order_id, id), eq(lending_order.issued_by_user_id, user.user_id)))
    if (!order) return NextResponse.json({ error: "Lending record not found" }, { status: 404 });

    const [lendingItem] = await db.select({ quantity: lending_item.quantity, lost_quantity: lending_item.lost_quantity }).from(lending_item).where(and(eq(lending_item.lend_order_id, id), eq(lending_item.product_id, product_id)))
    if (!lendingItem) {
      return NextResponse.json({ error: "Lending item not found" }, { status: 404 });
    }

    if (lost_quantity > lendingItem.quantity) {
      return NextResponse.json({ error: `Lost quantity (${lost_quantity}) exceeds lent quantity (${lendingItem.quantity})` }, { status: 400 });
    }

    const [stockData] = await db.select({ quantity: stocks.quantity, lost_quantity: stocks.lost_quantity }).from(stocks).where(eq(stocks.product_id, product_id))
    if (!stockData) {
      return NextResponse.json({ error: "Stock record not found" }, { status: 404 });
    }

    const newLentQuantity = lendingItem.quantity - lost_quantity;
    const newItemLostQty = (lendingItem.lost_quantity || 0) + lost_quantity;
    const newStockQuantity = Math.max(0, (stockData.quantity || 0) - lost_quantity);
    const newLostQuantity = (stockData.lost_quantity || 0) + lost_quantity;

    await db.transaction(async (tx) => {
      await tx.update(lending_item).set({ quantity: newLentQuantity, lost_quantity: newItemLostQty }).where(and(eq(lending_item.lend_order_id, id), eq(lending_item.product_id, product_id)))

      if (newLentQuantity === 0) {
        await tx.update(lending_order).set({ status: "LOST" }).where(eq(lending_order.lending_order_id, id))
      } else {
        const [lendingOrderRow] = await tx.select({ status: lending_order.status }).from(lending_order).where(eq(lending_order.lending_order_id, id))
        if (lendingOrderRow && (lendingOrderRow.status === "PENDING" || lendingOrderRow.status === "PARTIALLY_DAMAGED")) {
          await tx.update(lending_order).set({ status: "PARTIALLY_LOST" }).where(eq(lending_order.lending_order_id, id))
        }
      }

      await tx.update(stocks).set({ quantity: newStockQuantity, lost_quantity: newLostQuantity }).where(eq(stocks.product_id, product_id))
    })

    return NextResponse.json({
      success: true,
      newLentQuantity,
      newStockQuantity,
      newLostQuantity,
      orderStatus: newLentQuantity === 0 ? "LOST" : "PARTIALLY_LOST",
    });
  } catch {
    return NextResponse.json({ error: "Failed to mark items as lost" }, { status: 500 });
  }
}
