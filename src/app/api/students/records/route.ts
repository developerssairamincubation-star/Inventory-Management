import { NextRequest } from "next/server";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { lending_order, lending_item, students, departments, products } from "@/db/schema";
import { getPeriod, getStartDateByPeriod } from '@/lib/api/request'
import { fromError, ok } from '@/lib/api/response'
import { getAuthUser, unauthorizedResponse } from "@/lib/authMiddleware";

type LendingItemRow = {
  lend_order_id: string
  quantity: number
  original_quantity: number
  damaged_quantity: number
  lost_quantity: number
  product_id: string
  products: { product_name: string } | null
}

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
        borrower_student_id: lending_order.borrower_student_id,
      })
      .from(lending_order)
      .where(
        and(
          eq(lending_order.borrower_type, 'STUDENT'),
          eq(lending_order.issued_by_user_id, user.user_id),
          gte(lending_order.created_at, startDate),
        ),
      )
      .orderBy(desc(lending_order.created_at))

    const orderIds = lendingOrders.map((o) => o.lending_order_id)

    const lendingItems: LendingItemRow[] = orderIds.length
      ? await db
          .select({
            lend_order_id: lending_item.lend_order_id,
            quantity: lending_item.quantity,
            original_quantity: lending_item.original_quantity,
            damaged_quantity: lending_item.damaged_quantity,
            lost_quantity: lending_item.lost_quantity,
            product_id: lending_item.product_id,
            products: { product_name: products.product_name },
          })
          .from(lending_item)
          .leftJoin(products, eq(products.product_id, lending_item.product_id))
          .where(inArray(lending_item.lend_order_id, orderIds))
      : []

    const itemsByOrderId = new Map<string, LendingItemRow[]>()
    for (const item of lendingItems) {
      if (!itemsByOrderId.has(item.lend_order_id)) itemsByOrderId.set(item.lend_order_id, [])
      itemsByOrderId.get(item.lend_order_id)!.push(item)
    }

    const studentIds = lendingOrders.filter((o) => o.borrower_student_id).map((o) => o.borrower_student_id as string)

    const studentRows = studentIds.length
      ? await db
          .select({
            student_id: students.student_id,
            name: students.name,
            student_id_code: students.student_id_code,
            department_id: students.department_id,
            departments: { department_name: departments.department_name },
          })
          .from(students)
          .leftJoin(departments, eq(departments.department_id, students.department_id))
          .where(inArray(students.student_id, studentIds))
      : []

    const studentMap = new Map(studentRows.map((s) => [s.student_id, s]))

    const records = lendingOrders.flatMap((order) => {
      const student = order.borrower_student_id ? studentMap.get(order.borrower_student_id) : undefined
      const orderItems = itemsByOrderId.get(order.lending_order_id) || []

      const base = {
        student_id: student?.student_id || "",
        student_name: student?.name || "—",
        student_id_code: student?.student_id_code || null,
        department: student?.departments?.department_name || "—",
        borrow_date: order.created_at,
        return_date: order.return_date,
        status: order.status || "PENDING",
        mobile: "—",
      }

      if (orderItems.length === 0) {
        return [{
          ...base,
          product_name: "—",
          quantity: 0,
          original_quantity: 0,
          damaged_quantity: 0,
          lost_quantity: 0,
        }]
      }

      return orderItems.map((item) => ({
        ...base,
        product_name: item.products?.product_name || "—",
        quantity: item.quantity || 0,
        original_quantity: item.original_quantity ?? item.quantity ?? 0,
        damaged_quantity: item.damaged_quantity ?? 0,
        lost_quantity: item.lost_quantity ?? 0,
      }))
    })

    const uniqueStudents = new Set(records.map((r) => r.student_id).filter(Boolean))
    const totalBorrowed = uniqueStudents.size
    const returnedStudents = new Set(records.filter((r) => r.status === "RETURNED").map((r) => r.student_id).filter(Boolean))
    const pendingStudents = new Set(records.filter((r) => r.status === "PENDING").map((r) => r.student_id).filter(Boolean))

    return ok({
      records,
      stats: { totalBorrowed, returned: returnedStudents.size, pending: pendingStudents.size },
    })
  } catch (error) {
    return fromError(error)
  }
}
