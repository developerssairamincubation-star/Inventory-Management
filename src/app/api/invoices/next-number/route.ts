import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { purchase_invoice } from "@/db/schema";
import { requireUser } from '@/lib/authz'

export async function GET(request: NextRequest) {
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response
  const { user } = auth

  try {
    // Invoice numbers are per-user sequences — this is a pure preview (no
    // mutation): it reads the user's most recent invoice number and
    // computes what the next one would be. The actual number is only
    // persisted when the client submits POST /api/invoices.
    const [last] = await db
      .select({ invoice_number: purchase_invoice.invoice_number })
      .from(purchase_invoice)
      .where(eq(purchase_invoice.user_id, user.user_id))
      .orderBy(desc(purchase_invoice.created_at))
      .limit(1)

    let nextInvoiceNo = "INV001";

    if (last?.invoice_number) {
      const match = last.invoice_number.match(/INV(\d+)/);
      if (match) {
        const lastNumber = parseInt(match[1], 10);
        nextInvoiceNo = `INV${String(lastNumber + 1).padStart(3, '0')}`;
      }
    }

    return NextResponse.json({ invoice_no: nextInvoiceNo });
  } catch (error) {
    console.error('[GET /api/invoices/next-number] falling back to INV001:', error);
    return NextResponse.json({ invoice_no: "INV001" });
  }
}
