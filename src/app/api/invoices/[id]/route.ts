import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { purchase_invoice, purchase_invoice_item, products, stocks } from "@/db/schema";
import { getAuthUser, unauthorizedResponse } from "@/lib/authMiddleware";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const { id: invoiceId } = await params;

    // super_admin can open any invoice's detail (visibility only — delete
    // below stays owner-scoped); everyone else only their own.
    const invoiceCond = user.role === "super_admin"
      ? eq(purchase_invoice.invoice_id, invoiceId)
      : and(eq(purchase_invoice.invoice_id, invoiceId), eq(purchase_invoice.user_id, user.user_id))
    const [invoice] = await db.select().from(purchase_invoice).where(invoiceCond)
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const items = await db
      .select({
        product_name: purchase_invoice_item.product_name,
        quantity: purchase_invoice_item.quantity,
        unit_cost: purchase_invoice_item.unit_cost,
        total_cost: purchase_invoice_item.total_cost,
        products: { product_name: products.product_name },
      })
      .from(purchase_invoice_item)
      .leftJoin(products, eq(products.product_id, purchase_invoice_item.product_id))
      .where(eq(purchase_invoice_item.invoice_id, invoiceId))

    return NextResponse.json({
      invoice_id: invoice.invoice_id,
      invoice_number: invoice.invoice_number,
      supplier_name: invoice.supplier_name,
      received_date: invoice.received_date,
      created_at: invoice.created_at,
      // numeric columns come back as strings from Drizzle over JSON — coerce
      // to match the frontend's `number` type (see src/app/api/invoices/route.ts).
      total_amount: Number(invoice.total_amount) || 0,
      items: items.map((item) => ({
        product_name: item.products?.product_name || item.product_name || "Unknown Product",
        quantity: item.quantity,
        unit_cost: Number(item.unit_cost) || 0,
        total_cost: Number(item.total_cost) || 0,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const { id: invoiceId } = await params;

    // super_admin can delete any user's invoice; everyone else only their own.
    const deleteCond = user.role === "super_admin"
      ? eq(purchase_invoice.invoice_id, invoiceId)
      : and(eq(purchase_invoice.invoice_id, invoiceId), eq(purchase_invoice.user_id, user.user_id))
    const [invoice] = await db.select({ invoice_id: purchase_invoice.invoice_id }).from(purchase_invoice).where(deleteCond)
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    await db.transaction(async (tx) => {
      const items = await tx.select({ product_id: purchase_invoice_item.product_id, quantity: purchase_invoice_item.quantity }).from(purchase_invoice_item).where(eq(purchase_invoice_item.invoice_id, invoiceId))

      for (const item of items) {
        if (!item.product_id) continue
        await tx.update(stocks).set({ quantity: sql`GREATEST(0, ${stocks.quantity} - ${item.quantity})` }).where(eq(stocks.product_id, item.product_id))
      }

      await tx.delete(purchase_invoice_item).where(eq(purchase_invoice_item.invoice_id, invoiceId))
      await tx.delete(purchase_invoice).where(eq(purchase_invoice.invoice_id, invoiceId))
    })

    return NextResponse.json({ message: "Invoice deleted successfully" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}
