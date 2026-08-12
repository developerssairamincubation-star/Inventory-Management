import { NextRequest, NextResponse } from "next/server";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { purchase_invoice, purchase_invoice_item, stocks } from "@/db/schema";
import { getAuthUser, unauthorizedResponse } from "@/lib/authMiddleware";

type NormalisedItem = {
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
};

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const invoicesData = await db.select().from(purchase_invoice).where(eq(purchase_invoice.user_id, user.user_id)).orderBy(desc(purchase_invoice.created_at))

    if (invoicesData.length === 0) {
      return NextResponse.json({ invoices: [] });
    }

    const invoiceIds = invoicesData.map((inv) => inv.invoice_id)
    const itemsData = await db.select({ invoice_id: purchase_invoice_item.invoice_id }).from(purchase_invoice_item).where(inArray(purchase_invoice_item.invoice_id, invoiceIds))

    const itemsMap = new Map<string, number>()
    for (const item of itemsData) {
      itemsMap.set(item.invoice_id, (itemsMap.get(item.invoice_id) || 0) + 1)
    }

    const invoices = invoicesData.map((invoice) => ({
      invoice_id: invoice.invoice_id,
      invoice_number: invoice.invoice_number,
      supplier_name: invoice.supplier_name,
      received_date: invoice.received_date,
      items_count: itemsMap.get(invoice.invoice_id) || 0,
      total_amount: invoice.total_amount || 0,
    }))

    return NextResponse.json({ invoices });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const body = await request.json();
    const { invoice_number, supplier_name, received_date, items } = body;

    if (!invoice_number || !supplier_name || !received_date || !items || items.length === 0) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const normalisedItems: NormalisedItem[] = items.map((item: Record<string, unknown>) => ({
      product_id: (item.product_id as string) || null,
      product_name: String(item.product_name || "").trim(),
      quantity: Number(item.quantity) || 0,
      unit_cost: Number(item.unit_cost) || 0,
      total_cost: Number(item.total_cost) || 0,
    }))

    if (normalisedItems.some((item) => !item.product_name || item.quantity <= 0 || item.unit_cost < 0 || item.total_cost < 0)) {
      return NextResponse.json({ error: "Each invoice item must include a product name, quantity and cost" }, { status: 400 });
    }

    const total_amount = normalisedItems.reduce((sum, item) => sum + item.total_cost, 0)

    const invoice = await db.transaction(async (tx) => {
      const [invoiceRow] = await tx
        .insert(purchase_invoice)
        .values({ invoice_number, supplier_name, received_date, total_amount: String(total_amount), user_id: user.user_id })
        .returning()

      await tx.insert(purchase_invoice_item).values(
        normalisedItems.map((item) => ({
          invoice_id: invoiceRow.invoice_id,
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_cost: String(item.unit_cost),
          total_cost: String(item.total_cost),
        })),
      )

      for (const item of normalisedItems) {
        if (!item.product_id) continue
        const [stockRow] = await tx.select({ quantity: stocks.quantity }).from(stocks).where(eq(stocks.product_id, item.product_id))
        if (stockRow) {
          await tx.update(stocks).set({ quantity: sql`${stocks.quantity} + ${item.quantity}` }).where(eq(stocks.product_id, item.product_id))
        } else {
          await tx.insert(stocks).values({ product_id: item.product_id, quantity: item.quantity })
        }
      }

      return invoiceRow
    })

    return NextResponse.json({ message: "Invoice created successfully", invoice });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}
