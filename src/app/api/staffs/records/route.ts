import { NextRequest } from "next/server";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { lending_order, lending_item, staffs, departments, products } from "@/db/schema";
import { getPeriod, getStartDateByPeriod } from '@/lib/api/request'
import { fromError, ok } from '@/lib/api/response'
import { getAuthUser, unauthorizedResponse } from "@/lib/authMiddleware";

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const period = getPeriod(request.nextUrl.searchParams)
    const startDate = getStartDateByPeriod(period)

    const orders = await db
      .select()
      .from(lending_order)
      .where(
        and(
          eq(lending_order.borrower_type, 'STAFF'),
          eq(lending_order.issued_by_user_id, user.user_id),
          gte(lending_order.created_at, startDate),
        ),
      )
      .orderBy(desc(lending_order.created_at))

    if (orders.length === 0) {
      return ok({ records: [], stats: { totalBorrowed: 0, returned: 0, pending: 0 } })
    }

    const orderIds = orders.map((o) => o.lending_order_id)
    const items = await db.select().from(lending_item).where(inArray(lending_item.lend_order_id, orderIds))

    const itemsMap = new Map<string, typeof items>()
    for (const item of items) {
      if (!itemsMap.has(item.lend_order_id)) itemsMap.set(item.lend_order_id, [])
      itemsMap.get(item.lend_order_id)!.push(item)
    }

    const staffIds = new Set<string>()
    const mentorIds = new Set<string>()
    const productIds = new Set<string>()

    for (const order of orders) {
      if (order.borrower_staff_id) staffIds.add(order.borrower_staff_id)
      if (order.mentor_staff_id) mentorIds.add(order.mentor_staff_id)
      for (const item of itemsMap.get(order.lending_order_id) || []) {
        if (item.product_id) productIds.add(item.product_id)
      }
    }

    const staffsData = staffIds.size
      ? await db
          .select({
            staff_id: staffs.staff_id,
            name: staffs.name,
            departments: { department_name: departments.department_name },
          })
          .from(staffs)
          .leftJoin(departments, eq(departments.department_id, staffs.department_id))
          .where(inArray(staffs.staff_id, Array.from(staffIds)))
      : []

    const mentorsData = mentorIds.size
      ? await db.select({ staff_id: staffs.staff_id, name: staffs.name }).from(staffs).where(inArray(staffs.staff_id, Array.from(mentorIds)))
      : []

    const productsData = productIds.size
      ? await db
          .select({ product_id: products.product_id, product_name: products.product_name })
          .from(products)
          .where(inArray(products.product_id, Array.from(productIds)))
      : []

    const staffsMap = new Map(staffsData.map((s) => [s.staff_id, { name: s.name, department_name: s.departments?.department_name || "—" }]))
    const mentorsMap = new Map(mentorsData.map((m) => [m.staff_id, m.name]))
    const productsMap = new Map(productsData.map((p) => [p.product_id, p.product_name]))

    const records: Array<Record<string, unknown>> = []
    for (const order of orders) {
      const orderItems = itemsMap.get(order.lending_order_id) || []
      const staffInfo = (order.borrower_staff_id && staffsMap.get(order.borrower_staff_id)) || { name: "—", department_name: "—" }
      const mentorName = (order.mentor_staff_id && mentorsMap.get(order.mentor_staff_id)) || "—"

      for (const item of orderItems) {
        records.push({
          staff_id: order.borrower_staff_id,
          staff_name: staffInfo.name,
          department: staffInfo.department_name,
          mentor: mentorName,
          product_name: productsMap.get(item.product_id) || "—",
          quantity: item.quantity || 0,
          original_quantity: item.original_quantity ?? item.quantity ?? 0,
          damaged_quantity: item.damaged_quantity ?? 0,
          lost_quantity: item.lost_quantity ?? 0,
          borrow_date: order.created_at,
          // lending_item has no return_date column; this mirrors the
          // original Supabase route, which always evaluated to null here too.
          return_date: null,
          status: order.status,
          mobile: "—",
        })
      }
    }

    const borrowedStaffIds = new Set<string>()
    const returnedStaffIds = new Set<string>()
    const pendingStaffIds = new Set<string>()
    for (const order of orders) {
      if (order.borrower_staff_id) {
        borrowedStaffIds.add(order.borrower_staff_id)
        if (order.status === "RETURNED") returnedStaffIds.add(order.borrower_staff_id)
        else if (order.status === "PENDING") pendingStaffIds.add(order.borrower_staff_id)
      }
    }

    return ok({
      records,
      stats: { totalBorrowed: borrowedStaffIds.size, returned: returnedStaffIds.size, pending: pendingStaffIds.size },
    })
  } catch (error) {
    return fromError(error)
  }
}
