import { NextRequest, NextResponse } from "next/server";
import { desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { purchase_invoice, purchase_invoice_item, invoice_documents, stocks, users, coe_domains } from "@/db/schema";
import { getAuthUser, unauthorizedResponse } from "@/lib/authMiddleware";
import { classifyError } from "@/lib/api/classifyError";
import { allocateNextCode } from "@/lib/idSequences";

type NormalisedItem = {
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  location: string | null;
};

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    // super_admin sees invoices from every user/domain, not just their own —
    // everyone else stays scoped to invoices they personally uploaded.
    const isAdmin = user.role === "super_admin"

    const invoicesData = isAdmin
      ? await db
          .select({
            ...getTableColumns(purchase_invoice),
            owner_name: users.full_name,
            domain_name: coe_domains.domain_name,
          })
          .from(purchase_invoice)
          .leftJoin(users, eq(users.user_id, purchase_invoice.user_id))
          .leftJoin(coe_domains, eq(coe_domains.domain_id, users.domain_id))
          .orderBy(desc(purchase_invoice.created_at))
      : await db
          .select({ ...getTableColumns(purchase_invoice), owner_name: sql<string | null>`null`, domain_name: sql<string | null>`null` })
          .from(purchase_invoice)
          .where(eq(purchase_invoice.user_id, user.user_id))
          .orderBy(desc(purchase_invoice.created_at))

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
      invoice_code: invoice.invoice_code,
      invoice_number: invoice.invoice_number,
      supplier_name: invoice.supplier_name,
      received_date: invoice.received_date,
      items_count: itemsMap.get(invoice.invoice_id) || 0,
      // total_amount is a Postgres numeric column — Drizzle returns those as
      // strings over JSON, not numbers, so this must be coerced here to
      // match the frontend's `number` type (see the same fix in [id]/route.ts).
      total_amount: Number(invoice.total_amount) || 0,
      user_id: invoice.user_id,
      owner_name: invoice.owner_name ?? null,
      domain_name: invoice.domain_name ?? null,
    }))

    return NextResponse.json({ invoices });
  } catch (error) {
    console.error('[/api/invoices] error:', error);
    return NextResponse.json({ error: classifyError(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const body = await request.json();
    const { invoice_number, supplier_name, received_date, items, total_amount: providedTotal, invoice_file_url } = body;

    if (!invoice_number || !supplier_name || !received_date || !items || items.length === 0) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const normalisedItems: NormalisedItem[] = items.map((item: Record<string, unknown>) => ({
      product_id: (item.product_id as string) || null,
      product_name: String(item.product_name || "").trim(),
      quantity: Number(item.quantity) || 0,
      unit_cost: Number(item.unit_cost) || 0,
      total_cost: Number(item.total_cost) || 0,
      location: typeof item.location === "string" && item.location.trim() ? item.location.trim().slice(0, 50) : null,
    }))

    if (normalisedItems.some((item) => !item.product_name || item.quantity <= 0 || item.unit_cost < 0 || item.total_cost < 0)) {
      return NextResponse.json({ error: "Each invoice item must include a product name, quantity and cost" }, { status: 400 });
    }

    // The invoice's own printed total (which may include shipping/tax/discounts
    // and so can legitimately differ from the line items' sum) takes precedence
    // when the client provides one — see UploadInvoiceModal's "Invoice Total"
    // field. Falls back to the computed sum when omitted or invalid.
    const computedTotal = normalisedItems.reduce((sum, item) => sum + item.total_cost, 0)
    const total_amount = typeof providedTotal === 'number' && Number.isFinite(providedTotal) && providedTotal >= 0
      ? providedTotal
      : computedTotal

    const invoice = await db.transaction(async (tx) => {
      const invoice_code = await allocateNextCode(tx, 'invoice_code')

      const [invoiceRow] = await tx
        .insert(purchase_invoice)
        .values({ invoice_code, invoice_number, supplier_name, received_date, total_amount: String(total_amount), user_id: user.user_id })
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

      // The uploaded invoice PDF (already uploaded to Cloudinary client-side
      // before this request — see UploadInvoiceModal's executeSubmit) — the
      // source document, not just the parsed line items above.
      if (typeof invoice_file_url === 'string' && invoice_file_url) {
        await tx.insert(invoice_documents).values({
          invoice_id: invoiceRow.invoice_id,
          file_url: invoice_file_url,
          uploaded_by_user_id: user.user_id,
        })
      }

      // Aggregated in memory (not per-item queries) so a multi-line invoice
      // costs one round trip here regardless of item count — with the DB on
      // Neon rather than same-host Postgres, each extra round trip is real,
      // measurable latency, not just a query-count nicety.
      const stockUpdates = new Map<string, { quantity: number; location: string | null }>()
      for (const item of normalisedItems) {
        if (!item.product_id) continue
        const existing = stockUpdates.get(item.product_id)
        if (existing) {
          existing.quantity += item.quantity
          if (item.location) existing.location = item.location
        } else {
          stockUpdates.set(item.product_id, { quantity: item.quantity, location: item.location })
        }
      }

      if (stockUpdates.size > 0) {
        await tx
          .insert(stocks)
          .values(Array.from(stockUpdates, ([product_id, { quantity, location }]) => ({ product_id, quantity, location })))
          .onConflictDoUpdate({
            target: stocks.product_id,
            set: {
              quantity: sql`${stocks.quantity} + excluded.quantity`,
              // location is only overwritten when the incoming value is
              // non-null — omitting it on a restock keeps the existing location.
              location: sql`coalesce(excluded.location, ${stocks.location})`,
            },
          })
      }

      return invoiceRow
    })

    return NextResponse.json({ message: "Invoice created successfully", invoice });
  } catch (error) {
    console.error('[/api/invoices] error:', error);
    return NextResponse.json({ error: classifyError(error) }, { status: 500 });
  }
}
