import { NextRequest, NextResponse } from "next/server";
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { stocks } from '@/db/schema'
import { getAuthUser, unauthorizedResponse } from "@/lib/authMiddleware";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const { id } = await params;

    const [row] = await db.select({ quantity: stocks.quantity }).from(stocks).where(eq(stocks.product_id, id))

    if (!row) {
      return NextResponse.json({ error: 'Stock record not found' }, { status: 500 });
    }

    return NextResponse.json(row);
  } catch (error) {
    console.error('[GET /api/stocks/[id]] error:', error);
    return NextResponse.json({ error: "Failed to fetch stock" }, { status: 500 });
  }
}
