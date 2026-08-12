import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { lending_order, lending_item, students, staffs, departments, products, stocks } from "@/db/schema";
import { getPeriod, getStartDateByPeriod } from '@/lib/api/request'
import { fromError, ok } from '@/lib/api/response'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const period = getPeriod(request.nextUrl.searchParams)
    const startDate = getStartDateByPeriod(period)

    const lendingOrders = await db
      .select({
        lending_order_id: lending_order.lending_order_id,
        created_at: lending_order.created_at,
        due_date: lending_order.due_date,
        return_date: lending_order.return_date,
        status: lending_order.status,
        borrower_type: lending_order.borrower_type,
        borrower_student_id: lending_order.borrower_student_id,
        borrower_staff_id: lending_order.borrower_staff_id,
        mentor_staff_id: lending_order.mentor_staff_id,
        project_name: lending_order.project_name,
      })
      .from(lending_order)
      .where(and(eq(lending_order.issued_by_user_id, user.user_id), gte(lending_order.created_at, startDate)))
      .orderBy(desc(lending_order.created_at))

    const orderIds = lendingOrders.map((o) => o.lending_order_id)

    const lendingItems = orderIds.length
      ? await db
          .select({
            lend_order_id: lending_item.lend_order_id,
            quantity: lending_item.quantity,
            original_quantity: lending_item.original_quantity,
            damaged_quantity: lending_item.damaged_quantity,
            lost_quantity: lending_item.lost_quantity,
            product_id: lending_item.product_id,
            products: { product_name: products.product_name, product_code: products.product_code },
          })
          .from(lending_item)
          .leftJoin(products, eq(products.product_id, lending_item.product_id))
          .where(inArray(lending_item.lend_order_id, orderIds))
      : []

    const itemsByOrderId = new Map<string, typeof lendingItems>()
    for (const item of lendingItems) {
      if (!itemsByOrderId.has(item.lend_order_id)) itemsByOrderId.set(item.lend_order_id, [])
      itemsByOrderId.get(item.lend_order_id)!.push(item)
    }

    const studentIds = lendingOrders.filter((o) => o.borrower_type === 'STUDENT' && o.borrower_student_id).map((o) => o.borrower_student_id as string)
    const staffIds = lendingOrders.filter((o) => o.borrower_type === 'STAFF' && o.borrower_staff_id).map((o) => o.borrower_staff_id as string)
    const mentorIds = lendingOrders.filter((o) => o.mentor_staff_id).map((o) => o.mentor_staff_id as string)

    const studentRows = studentIds.length
      ? await db
          .select({ student_id: students.student_id, name: students.name, departments: { department_name: departments.department_name } })
          .from(students)
          .leftJoin(departments, eq(departments.department_id, students.department_id))
          .where(inArray(students.student_id, studentIds))
      : []

    const staffRows = staffIds.length
      ? await db
          .select({ staff_id: staffs.staff_id, name: staffs.name, departments: { department_name: departments.department_name } })
          .from(staffs)
          .leftJoin(departments, eq(departments.department_id, staffs.department_id))
          .where(inArray(staffs.staff_id, staffIds))
      : []

    const mentorRows = mentorIds.length
      ? await db.select({ staff_id: staffs.staff_id, name: staffs.name }).from(staffs).where(inArray(staffs.staff_id, mentorIds))
      : []

    const studentMap = new Map(studentRows.map((s) => [s.student_id, s]))
    const staffMap = new Map(staffRows.map((s) => [s.staff_id, s]))
    const mentorMap = new Map(mentorRows.map((m) => [m.staff_id, m.name]))

    const records = lendingOrders.flatMap((order) => {
      const borrower = order.borrower_type === 'STUDENT'
        ? (order.borrower_student_id ? studentMap.get(order.borrower_student_id) : undefined)
        : (order.borrower_staff_id ? staffMap.get(order.borrower_staff_id) : undefined)
      const department = borrower?.departments
      const orderItems = itemsByOrderId.get(order.lending_order_id) || []
      const mentor = (order.mentor_staff_id && mentorMap.get(order.mentor_staff_id)) || '—'

      if (orderItems.length === 0) {
        return [{
          id: order.lending_order_id,
          borrower_name: borrower?.name || '—',
          borrower_type: order.borrower_type || '—',
          department: department?.department_name || '—',
          product_name: '—', product_code: '—', product_id: null,
          quantity: 0, original_quantity: 0, damaged_quantity: 0, lost_quantity: 0,
          lending_date: order.created_at, due_date: order.due_date, return_date: order.return_date,
          status: order.status || 'PENDING', mentor,
        }]
      }

      return orderItems.map((item) => ({
        id: order.lending_order_id,
        borrower_name: borrower?.name || '—',
        borrower_type: order.borrower_type || '—',
        department: department?.department_name || '—',
        product_name: item.products?.product_name || '—',
        product_code: item.products?.product_code || '—',
        product_id: item.product_id || null,
        quantity: item.quantity || 0,
        original_quantity: item.original_quantity ?? item.quantity ?? 0,
        damaged_quantity: item.damaged_quantity || 0,
        lost_quantity: item.lost_quantity || 0,
        lending_date: order.created_at,
        due_date: order.due_date,
        return_date: order.return_date,
        status: order.status || 'PENDING',
        mentor,
      }))
    })

    const EXCLUDED = ['RETURNED', 'RETURNED_DAMAGED', 'RETURNED_LOST', 'DAMAGED', 'LOST']
    const activeLentRecords = records.filter((r) => !EXCLUDED.includes(r.status))
    const totalQuantity = activeLentRecords.reduce((sum, r) => sum + (r.quantity || 0), 0)
    const uniqueProducts = new Set(activeLentRecords.map((r) => r.product_name).filter((name) => name !== '—')).size
    const returned = records.filter((r) => r.status === 'RETURNED' || r.status === 'RETURNED_DAMAGED' || r.status === 'RETURNED_LOST').length
    const pending = records.filter((r) => ['PENDING', 'CONSUMABLE', 'PARTIALLY_RETURNED', 'PARTIALLY_DAMAGED', 'PARTIALLY_LOST'].includes(r.status)).length

    return ok({ records, stats: { totalLent: uniqueProducts, totalQuantity, returned, pending } })
  } catch (error) {
    return fromError(error)
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const body = await request.json()

    const {
      borrower_type,
      borrower_name,
      department_id,
      lending_items,
      lending_date,
      due_date,
      project_name,
      mentor_staff_id,
      status,
      borrower_id,
    } = body

    const result = await db.transaction(async (tx) => {
      let borrowerId: string | null = borrower_id ?? null

      if (!borrowerId) {
        if (borrower_type === 'STUDENT') {
          const [existing] = await tx.select({ student_id: students.student_id }).from(students).where(and(eq(students.name, borrower_name), eq(students.department_id, department_id)))
          if (existing) {
            borrowerId = existing.student_id
          } else {
            const [created] = await tx.insert(students).values({ name: borrower_name, department_id }).returning({ student_id: students.student_id })
            borrowerId = created.student_id
          }
        } else if (borrower_type === 'STAFF') {
          const [existing] = await tx.select({ staff_id: staffs.staff_id }).from(staffs).where(and(eq(staffs.name, borrower_name), eq(staffs.department_id, department_id)))
          if (existing) {
            borrowerId = existing.staff_id
          } else {
            const [created] = await tx.insert(staffs).values({ name: borrower_name, department_id }).returning({ staff_id: staffs.staff_id })
            borrowerId = created.staff_id
          }
        }
      }

      const orderData: typeof lending_order.$inferInsert = {
        borrower_type,
        issued_by_user_id: user.user_id,
        created_at: lending_date ? new Date(lending_date) : new Date(),
        due_date: due_date || null,
        status: status || 'PENDING',
        project_name: project_name || null,
        mentor_staff_id: mentor_staff_id || null,
      }
      if (borrower_type === 'STUDENT') orderData.borrower_student_id = borrowerId
      else if (borrower_type === 'STAFF') orderData.borrower_staff_id = borrowerId

      const [order] = await tx.insert(lending_order).values(orderData).returning()

      const itemsToInsert = (lending_items as Array<{ product_id: string; quantity: number }>).map((item) => ({
        lend_order_id: order.lending_order_id,
        product_id: item.product_id,
        quantity: item.quantity,
        original_quantity: item.quantity,
        damaged_quantity: 0,
        lost_quantity: 0,
        status: (status === 'CONSUMABLE' ? 'NON_RETURNABLE_GIVEN' : 'ISSUED') as 'NON_RETURNABLE_GIVEN' | 'ISSUED',
      }))

      const items = await tx.insert(lending_item).values(itemsToInsert).returning()

      for (const item of lending_items as Array<{ product_id: string; quantity: number }>) {
        const [currentStock] = await tx.select({ quantity: stocks.quantity }).from(stocks).where(eq(stocks.product_id, item.product_id))
        if (currentStock) {
          await tx.update(stocks).set({ quantity: Math.max(0, (currentStock.quantity || 0) - item.quantity) }).where(eq(stocks.product_id, item.product_id))
        }
      }

      return { order, items }
    })

    return NextResponse.json(result, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Failed to create lending record' }, { status: 500 })
  }
}
