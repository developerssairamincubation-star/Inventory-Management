import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray, lt } from 'drizzle-orm'
import { db } from '@/db/client'
import { lending_order, lending_item, products, students, staffs } from '@/db/schema'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const today = new Date().toISOString().split('T')[0]

    const overdueOrders = await db
      .select({
        lending_order_id: lending_order.lending_order_id,
        due_date: lending_order.due_date,
        status: lending_order.status,
        borrower_type: lending_order.borrower_type,
        borrower_student_id: lending_order.borrower_student_id,
        borrower_staff_id: lending_order.borrower_staff_id,
      })
      .from(lending_order)
      .where(and(eq(lending_order.issued_by_user_id, user.user_id), lt(lending_order.due_date, today), eq(lending_order.status, 'PENDING')))

    if (overdueOrders.length === 0) {
      return NextResponse.json([])
    }

    const orderIds = overdueOrders.map((o) => o.lending_order_id)

    const lendingItems = await db
      .select({ lend_order_id: lending_item.lend_order_id, product_id: lending_item.product_id, products: { product_name: products.product_name } })
      .from(lending_item)
      .leftJoin(products, eq(products.product_id, lending_item.product_id))
      .where(inArray(lending_item.lend_order_id, orderIds))

    const studentIds = overdueOrders.filter((o) => o.borrower_type === 'STUDENT' && o.borrower_student_id).map((o) => o.borrower_student_id as string)
    const staffIds = overdueOrders.filter((o) => o.borrower_type === 'STAFF' && o.borrower_staff_id).map((o) => o.borrower_staff_id as string)

    const studentRows = studentIds.length ? await db.select({ student_id: students.student_id, name: students.name }).from(students).where(inArray(students.student_id, studentIds)) : []
    const staffRows = staffIds.length ? await db.select({ staff_id: staffs.staff_id, name: staffs.name }).from(staffs).where(inArray(staffs.staff_id, staffIds)) : []

    const studentMap = new Map(studentRows.map((s) => [s.student_id, s.name]))
    const staffMap = new Map(staffRows.map((s) => [s.staff_id, s.name]))

    const itemsByOrder = new Map<string, typeof lendingItems>()
    for (const item of lendingItems) {
      if (!itemsByOrder.has(item.lend_order_id)) itemsByOrder.set(item.lend_order_id, [])
      itemsByOrder.get(item.lend_order_id)!.push(item)
    }

    const overdueAlerts = overdueOrders.flatMap((order) => {
      const borrowerName =
        order.borrower_type === 'STUDENT'
          ? (order.borrower_student_id && studentMap.get(order.borrower_student_id)) || 'Unknown Student'
          : (order.borrower_staff_id && staffMap.get(order.borrower_staff_id)) || 'Unknown Staff'

      const items = itemsByOrder.get(order.lending_order_id) || []
      return items.map((item) => ({
        lending_order_id: order.lending_order_id,
        borrower_name: borrowerName,
        product_name: item.products?.product_name || 'Unknown Product',
        due_date: order.due_date,
      }))
    })

    return NextResponse.json(overdueAlerts)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal Server Error' }, { status: 500 })
  }
}
