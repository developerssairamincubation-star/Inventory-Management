import { NextRequest } from "next/server";
import { and, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { purchase_invoice, purchase_invoice_item, invoice_documents, products, users, coe_domains } from "@/db/schema";
import { requireUser, invoiceScope, productScope } from "@/lib/authz";
import { ApiError } from "@/lib/api/errors";
import { fromError, ok, created } from "@/lib/api/response";
import { allocateNextCode } from "@/lib/idSequences";
import { adjustStock, actorFrom } from "@/lib/stock";
import { isTrustedAssetUrl } from "@/lib/cloudinary";
import { parseBody, money, positiveQuantity, isoDateOnly, uuid } from "@/lib/validation";
import { requestIdFrom } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response
  const { scope } = auth

  try {
    // Scoped to the caller's COE domain (derived from the uploading user's
    // domain), or every domain for a super_admin.
    const visible = invoiceScope(scope)

    const invoicesData = await db
      .select({
        ...getTableColumns(purchase_invoice),
        owner_name: users.full_name,
        domain_name: coe_domains.domain_name,
      })
      .from(purchase_invoice)
      .leftJoin(users, eq(users.user_id, purchase_invoice.user_id))
      .leftJoin(coe_domains, eq(coe_domains.domain_id, users.domain_id))
      .where(visible)
      .orderBy(desc(purchase_invoice.created_at))

    if (invoicesData.length === 0) {
      return ok({ invoices: [] })
    }

    const invoiceIds = invoicesData.map((inv) => inv.invoice_id)
    const itemsData = await db
      .select({ invoice_id: purchase_invoice_item.invoice_id })
      .from(purchase_invoice_item)
      .where(inArray(purchase_invoice_item.invoice_id, invoiceIds))

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
      // match the frontend's `number` type.
      total_amount: Number(invoice.total_amount) || 0,
      user_id: invoice.user_id,
      owner_name: invoice.owner_name ?? null,
      domain_name: invoice.domain_name ?? null,
    }))

    return ok({ invoices })
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(request), userId: auth.user.user_id, route: 'GET /api/invoices' })
  }
}

const createInvoiceSchema = z.object({
  invoice_number: z.string().trim().min(1).max(100),
  supplier_name: z.string().trim().min(1).max(250),
  received_date: isoDateOnly,
  total_amount: money.optional(),
  invoice_file_url: z.string().url().optional().nullable(),
  items: z
    .array(
      z.object({
        // Optional: a line may reference free text when no product row exists
        // yet. When present it must be a real product the caller can see —
        // enforced in the transaction below.
        product_id: uuid.nullish(),
        product_name: z.string().trim().min(1).max(500),
        quantity: positiveQuantity,
        unit_cost: money,
        total_cost: money,
        location: z.string().trim().max(50).nullish(),
      }),
    )
    .min(1, 'An invoice needs at least one line item')
    .max(500, 'Too many line items in one invoice'),
})

export async function POST(request: NextRequest) {
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response
  const { user, scope } = auth
  const actor = actorFrom(user, requestIdFrom(request))

  try {
    const body = await parseBody(request, createInvoiceSchema)

    if (body.invoice_file_url && !isTrustedAssetUrl(body.invoice_file_url)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invoice document must be an uploaded file')
    }

    // The invoice's own printed total (which may include shipping/tax/discounts
    // and so can legitimately differ from the line items' sum) takes precedence
    // when the client provides one. Falls back to the computed sum.
    const computedTotal = body.items.reduce((sum, item) => sum + item.total_cost, 0)
    const total_amount = body.total_amount ?? computedTotal

    // Aggregated before the transaction so a multi-line invoice costs one
    // locked adjustment per product rather than one per line.
    const stockUpdates = new Map<string, { quantity: number; location: string | null }>()
    for (const item of body.items) {
      if (!item.product_id) continue
      const existing = stockUpdates.get(item.product_id)
      if (existing) {
        existing.quantity += item.quantity
        if (item.location) existing.location = item.location
      } else {
        stockUpdates.set(item.product_id, { quantity: item.quantity, location: item.location ?? null })
      }
    }

    const invoice = await db.transaction(async (tx) => {
      // The hole this closes: product_id came straight from the request body
      // into an upsert on `stocks` with no ownership check at all, so any
      // authenticated user could add arbitrary quantities to any other COE's
      // products — and overwrite their storage location while doing it.
      const referencedIds = [...stockUpdates.keys()]
      if (referencedIds.length > 0) {
        const visible = productScope(scope)
        const allowed = await tx
          .select({ product_id: products.product_id })
          .from(products)
          .where(visible ? and(inArray(products.product_id, referencedIds), visible) : inArray(products.product_id, referencedIds))

        if (allowed.length !== referencedIds.length) {
          throw new ApiError(404, 'NOT_FOUND', 'One or more products are not available in your inventory')
        }
      }

      const invoice_code = await allocateNextCode(tx, 'invoice_code')

      const [invoiceRow] = await tx
        .insert(purchase_invoice)
        .values({
          invoice_code,
          invoice_number: body.invoice_number,
          supplier_name: body.supplier_name,
          received_date: body.received_date,
          total_amount: String(total_amount),
          user_id: user.user_id,
        })
        .returning()

      await tx.insert(purchase_invoice_item).values(
        body.items.map((item) => ({
          invoice_id: invoiceRow.invoice_id,
          product_id: item.product_id ?? null,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_cost: String(item.unit_cost),
          total_cost: String(item.total_cost),
        })),
      )

      if (body.invoice_file_url) {
        await tx.insert(invoice_documents).values({
          invoice_id: invoiceRow.invoice_id,
          file_url: body.invoice_file_url,
          uploaded_by_user_id: user.user_id,
        })
      }

      for (const [product_id, { quantity, location }] of stockUpdates) {
        await adjustStock(tx, {
          productId: product_id,
          delta: quantity,
          reason: 'INVOICE_RESTOCK',
          actor,
          referenceId: invoiceRow.invoice_id,
          note: `Restocked from invoice ${invoiceRow.invoice_code}`,
          // Legacy products may have no stocks row yet; the old upsert
          // created one implicitly and restocking must keep working.
          createIfMissing: true,
        })
        // location is only overwritten when the incoming value is non-null —
        // omitting it on a restock keeps the existing location.
        if (location) {
          await tx.execute(sql`UPDATE stocks SET location = ${location} WHERE product_id = ${product_id}`)
        }
      }

      return invoiceRow
    })

    return created({ message: 'Invoice created successfully', invoice })
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(request), userId: user.user_id, route: 'POST /api/invoices' })
  }
}
