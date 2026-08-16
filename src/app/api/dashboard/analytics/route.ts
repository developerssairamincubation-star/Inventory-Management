import { NextRequest } from 'next/server'
import { and, eq, gte, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { lending_order, lending_item, students, departments, products, stocks, category, coe_domains } from '@/db/schema'
import { ok, fromError } from '@/lib/api/response'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'

export const dynamic = 'force-dynamic'

// "Active" mirrors the Entry/Returnable pages' PENDING_STATUSES — anything
// with a balance still outstanding, plus CONSUMABLE orders (nothing to
// return, but still counted as this month/department's activity).
const ACTIVE_STATUSES = ['PENDING', 'PARTIALLY_RETURNED', 'PARTIALLY_DAMAGED', 'PARTIALLY_LOST', 'CONSUMABLE']
const RETURNED_STATUSES = ['RETURNED', 'RETURNED_DAMAGED', 'RETURNED_LOST']

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    // Reference data (students/departments/categories/domains) is shared
    // across all COEs, not scoped to issued_by_user_id like lending is.
    const [studentRows, departmentRows, categoryRows, domainRows] = await Promise.all([
      db.select({ student_id: students.student_id, department_id: students.department_id }).from(students),
      db.select({ department_id: departments.department_id, department_name: departments.department_name, code: departments.code }).from(departments),
      db.select({ category_id: category.category_id, category_name: category.category_name }).from(category),
      db.select({ domain_id: coe_domains.domain_id }).from(coe_domains),
    ])

    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

    const orders = await db
      .select({
        lending_order_id: lending_order.lending_order_id,
        status: lending_order.status,
        created_at: lending_order.created_at,
        return_date: lending_order.return_date,
        borrower_student_id: lending_order.borrower_student_id,
      })
      .from(lending_order)
      .where(and(eq(lending_order.issued_by_user_id, user.user_id), gte(lending_order.created_at, oneYearAgo)))

    const orderIds = orders.map((o) => o.lending_order_id)
    const items = orderIds.length
      ? await db
          .select({ lend_order_id: lending_item.lend_order_id, item_type: lending_item.item_type, original_quantity: lending_item.original_quantity, quantity: lending_item.quantity })
          .from(lending_item)
          .where(inArray(lending_item.lend_order_id, orderIds))
      : []

    const myProducts = await db
      .select({ product_id: products.product_id, category_id: products.category_id })
      .from(products)
      .where(eq(products.user_id, user.user_id))
    const myProductIds = myProducts.map((p) => p.product_id)
    const myStocks = myProductIds.length
      ? await db.select({ product_id: stocks.product_id, quantity: stocks.quantity }).from(stocks).where(inArray(stocks.product_id, myProductIds))
      : []

    // ---- item type split (RETURNABLE vs CONSUMABLE, by quantity issued) ----
    const itemTypeSplit = { returnable: 0, consumable: 0 }
    for (const it of items) {
      const qty = it.original_quantity ?? it.quantity ?? 0
      if (it.item_type === 'CONSUMABLE') itemTypeSplit.consumable += qty
      else itemTypeSplit.returnable += qty
    }

    // ---- status split (order-level) ----
    const statusSplit = { pending: 0, returned: 0, damaged: 0, lost: 0, consumable: 0 }
    for (const o of orders) {
      if (o.status === 'CONSUMABLE') statusSplit.consumable++
      else if (RETURNED_STATUSES.includes(o.status)) statusSplit.returned++
      else if (o.status === 'DAMAGED') statusSplit.damaged++
      else if (o.status === 'LOST') statusSplit.lost++
      else statusSplit.pending++
    }

    // ---- department breakdown (top 6 by total orders) ----
    const studentDeptMap = new Map(studentRows.map((s) => [s.student_id, s.department_id]))
    const deptInfoMap = new Map(departmentRows.map((d) => [d.department_id, d]))
    const deptAgg = new Map<string, { total: number; active: number }>()
    for (const o of orders) {
      const deptId = o.borrower_student_id ? studentDeptMap.get(o.borrower_student_id) : null
      if (!deptId) continue
      const cur = deptAgg.get(deptId) || { total: 0, active: 0 }
      cur.total++
      if (ACTIVE_STATUSES.includes(o.status)) cur.active++
      deptAgg.set(deptId, cur)
    }
    const departmentBreakdown = Array.from(deptAgg.entries())
      .map(([deptId, agg]) => ({
        department_name: deptInfoMap.get(deptId)?.department_name || 'Unknown',
        code: deptInfoMap.get(deptId)?.code || null,
        ...agg,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6)

    // ---- category breakdown (top 6 by total stock) ----
    const catNameMap = new Map(categoryRows.map((c) => [c.category_id, c.category_name]))
    const stockByProduct = new Map(myStocks.map((s) => [s.product_id, s.quantity || 0]))
    const catAgg = new Map<string, { total_products: number; total_stock: number }>()
    for (const p of myProducts) {
      const key = p.category_id || '__uncategorized__'
      const cur = catAgg.get(key) || { total_products: 0, total_stock: 0 }
      cur.total_products++
      cur.total_stock += stockByProduct.get(p.product_id) || 0
      catAgg.set(key, cur)
    }
    const categoryBreakdown = Array.from(catAgg.entries())
      .map(([catId, agg]) => ({
        category_name: catId === '__uncategorized__' ? 'Uncategorized' : catNameMap.get(catId) || 'Unknown',
        ...agg,
      }))
      .sort((a, b) => b.total_stock - a.total_stock)
      .slice(0, 6)

    // ---- monthly trend (last 12 calendar months) ----
    const now = new Date()
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1)
      return { key: monthKey(d), label: monthLabel(d), issued: 0, returned: 0 }
    })
    const monthIndex = new Map(months.map((m, idx) => [m.key, idx]))
    for (const o of orders) {
      const issuedIdx = monthIndex.get(monthKey(new Date(o.created_at)))
      if (issuedIdx !== undefined) months[issuedIdx].issued++
      if (o.return_date) {
        const returnedIdx = monthIndex.get(monthKey(new Date(o.return_date)))
        if (returnedIdx !== undefined) months[returnedIdx].returned++
      }
    }

    return ok({
      counts: {
        totalStudents: studentRows.length,
        totalDepartments: departmentRows.length,
        totalCategories: categoryRows.length,
        totalDomains: domainRows.length,
        totalOrders: orders.length,
      },
      itemTypeSplit,
      statusSplit,
      departmentBreakdown,
      categoryBreakdown,
      monthlyTrend: months,
    })
  } catch (error) {
    return fromError(error)
  }
}
