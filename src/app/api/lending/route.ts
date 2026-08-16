import { NextRequest } from "next/server";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { lending_order, lending_item, students, departments, products, stocks, coe_domains } from "@/db/schema";
import { getPeriod, getStartDateByPeriod } from '@/lib/api/request'
import { ApiError } from '@/lib/api/errors'
import { fromError, ok, created } from '@/lib/api/response'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'
import { decodeStudentIdCode, normalizeStudentIdCode } from '@/lib/studentIdCode'

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
        domain_id: lending_order.domain_id,
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
            item_type: lending_item.item_type,
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

    const studentIds = lendingOrders.filter((o) => o.borrower_student_id).map((o) => o.borrower_student_id as string)
    const domainIds = lendingOrders.filter((o) => o.domain_id).map((o) => o.domain_id as string)

    const studentRows = studentIds.length
      ? await db
          .select({ student_id: students.student_id, name: students.name, student_id_code: students.student_id_code, departments: { department_name: departments.department_name, code: departments.code } })
          .from(students)
          .leftJoin(departments, eq(departments.department_id, students.department_id))
          .where(inArray(students.student_id, studentIds))
      : []

    const domainRows = domainIds.length
      ? await db.select({ domain_id: coe_domains.domain_id, domain_name: coe_domains.domain_name, room_name: coe_domains.room_name }).from(coe_domains).where(inArray(coe_domains.domain_id, domainIds))
      : []

    const studentMap = new Map(studentRows.map((s) => [s.student_id, s]))
    const domainMap = new Map(domainRows.map((d) => [d.domain_id, d]))

    const records = lendingOrders.flatMap((order) => {
      const borrower = order.borrower_student_id ? studentMap.get(order.borrower_student_id) : undefined
      const domain = order.domain_id ? domainMap.get(order.domain_id) : undefined
      const orderItems = itemsByOrderId.get(order.lending_order_id) || []

      const base = {
        borrower_name: borrower?.name || '—',
        student_id_code: borrower?.student_id_code || null,
        department: borrower?.departments?.department_name || '—',
        department_code: borrower?.departments?.code || null,
        domain_name: domain?.domain_name || '—',
        room_name: domain?.room_name || '—',
        lending_date: order.created_at,
        due_date: order.due_date,
        return_date: order.return_date,
        status: order.status || 'PENDING',
      }

      if (orderItems.length === 0) {
        return [{
          id: order.lending_order_id,
          ...base,
          product_name: '—', product_code: '—', product_id: null as string | null, item_type: null as 'RETURNABLE' | 'CONSUMABLE' | null,
          quantity: 0, original_quantity: 0, damaged_quantity: 0, lost_quantity: 0,
        }]
      }

      return orderItems.map((item) => ({
        id: order.lending_order_id,
        ...base,
        product_name: item.products?.product_name || '—',
        product_code: item.products?.product_code || '—',
        product_id: item.product_id || null,
        item_type: item.item_type,
        quantity: item.quantity || 0,
        original_quantity: item.original_quantity ?? item.quantity ?? 0,
        damaged_quantity: item.damaged_quantity || 0,
        lost_quantity: item.lost_quantity || 0,
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

type LendingItemInput = { product_id: string; quantity: number; item_type: 'RETURNABLE' | 'CONSUMABLE' }

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const body = await request.json()
    const {
      lending_items,
      student_id_code,
      student_name,
      lending_date,
      due_date,
      domain_id: bodyDomainId,
    } = body as {
      lending_items: LendingItemInput[]
      student_id_code: string
      student_name?: string
      lending_date?: string
      due_date?: string
      domain_id?: string
    }

    if (!student_id_code || typeof student_id_code !== 'string') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'student_id_code is required')
    }
    if (!Array.isArray(lending_items) || lending_items.length === 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'lending_items must be a non-empty array')
    }

    const decoded = decodeStudentIdCode(student_id_code)
    if (!decoded) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Unrecognized student ID format')
    }
    const normalizedCode = normalizeStudentIdCode(student_id_code)

    // Domain/room: auto from the issuing COE user, or the caller's explicit
    // choice when the issuer has none (e.g. a super_admin issuing on behalf
    // of a COE — see the lending form's admin domain picker).
    const domainId = user.domain_id ?? bodyDomainId ?? null
    if (!domainId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'A domain/room must be specified')
    }

    const result = await db.transaction(async (tx) => {
      const [department] = await tx
        .select({ department_id: departments.department_id })
        .from(departments)
        .where(eq(departments.code, decoded.deptCode))
      if (!department) {
        throw new ApiError(422, 'UNKNOWN_DEPARTMENT', 'Unknown department code — check Admin Settings')
      }

      const [domain] = await tx.select({ domain_id: coe_domains.domain_id }).from(coe_domains).where(eq(coe_domains.domain_id, domainId))
      if (!domain) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'domain_id does not reference an existing COE domain')
      }

      // Get-or-create the student by their ID code. Re-scanning a known ID
      // only fills the name if it's currently blank — never overwrites an
      // existing name.
      const [existingStudent] = await tx
        .select({ student_id: students.student_id, name: students.name })
        .from(students)
        .where(eq(students.student_id_code, normalizedCode))

      let borrowerId: string
      if (existingStudent) {
        borrowerId = existingStudent.student_id
        if (student_name && !existingStudent.name) {
          await tx.update(students).set({ name: student_name }).where(eq(students.student_id, borrowerId))
        }
      } else {
        const [createdStudent] = await tx
          .insert(students)
          .values({ student_id_code: normalizedCode, department_id: department.department_id, name: student_name || null })
          .returning({ student_id: students.student_id })
        borrowerId = createdStudent.student_id
      }

      // item_type (RETURNABLE/CONSUMABLE) is chosen per line item here at
      // lending time — there's no per-product flag to validate it against
      // (products.returnable/consumable were dropped in V24). Still confirm
      // every product_id is real.
      const productIds = lending_items.map((item) => item.product_id)
      const productRows = await tx
        .select({ product_id: products.product_id, product_name: products.product_name })
        .from(products)
        .where(inArray(products.product_id, productIds))
      const productMap = new Map(productRows.map((p) => [p.product_id, p]))

      for (const item of lending_items) {
        if (!productMap.has(item.product_id)) {
          throw new ApiError(400, 'VALIDATION_ERROR', `Unknown product_id: ${item.product_id}`)
        }
      }

      // Order status: CONSUMABLE only if every item is consumable, else the
      // normal PENDING lifecycle (mixed returnable+consumable orders are
      // new territory — see MIGRATION notes on downstream aggregates).
      const allConsumable = lending_items.every((item) => item.item_type === 'CONSUMABLE')

      const [order] = await tx
        .insert(lending_order)
        .values({
          borrower_type: 'STUDENT',
          borrower_student_id: borrowerId,
          issued_by_user_id: user.user_id,
          domain_id: domainId,
          created_at: lending_date ? new Date(lending_date) : new Date(),
          due_date: due_date || null,
          status: allConsumable ? 'CONSUMABLE' : 'PENDING',
        })
        .returning()

      const itemsToInsert = lending_items.map((item) => ({
        lend_order_id: order.lending_order_id,
        product_id: item.product_id,
        quantity: item.quantity,
        original_quantity: item.quantity,
        damaged_quantity: 0,
        lost_quantity: 0,
        item_type: item.item_type,
        status: (item.item_type === 'CONSUMABLE' ? 'NON_RETURNABLE_GIVEN' : 'ISSUED') as 'NON_RETURNABLE_GIVEN' | 'ISSUED',
      }))

      const items = await tx.insert(lending_item).values(itemsToInsert).returning()

      for (const item of lending_items) {
        const [currentStock] = await tx.select({ quantity: stocks.quantity }).from(stocks).where(eq(stocks.product_id, item.product_id))
        if (currentStock) {
          await tx.update(stocks).set({ quantity: Math.max(0, (currentStock.quantity || 0) - item.quantity) }).where(eq(stocks.product_id, item.product_id))
        }
      }

      return { order, items }
    })

    return created(result)
  } catch (error) {
    return fromError(error)
  }
}
