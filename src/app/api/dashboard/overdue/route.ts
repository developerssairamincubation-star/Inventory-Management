import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const today = new Date().toISOString().split('T')[0]

    // Fetch lending orders where due_date has passed and status is PENDING
    const { data: overdueOrders, error: ordersError } = await supabaseAdmin
      .from('lending_order')
      .select(`
        lending_order_id,
        due_date,
        status,
        borrower_type,
        borrower_student_id,
        borrower_staff_id
      `)
      .lt('due_date', today)
      .eq('status', 'PENDING')

    if (ordersError) {
      console.error('Error fetching overdue orders:', ordersError)
      return NextResponse.json({ error: ordersError.message }, { status: 500 })
    }

    if (!overdueOrders || overdueOrders.length === 0) {
      return NextResponse.json([])
    }

    // Get lending items for these orders
    const orderIds = overdueOrders.map((o: any) => o.lending_order_id)

    const { data: lendingItems, error: itemsError } = await supabaseAdmin
      .from('lending_item')
      .select(`
        lend_order_id,
        product_id,
        products (
          product_name
        )
      `)
      .in('lend_order_id', orderIds)

    if (itemsError) {
      console.error('Error fetching lending items:', itemsError)
      return NextResponse.json({ error: itemsError.message }, { status: 500 })
    }

    // Collect borrower IDs
    const studentIds = overdueOrders
      .filter((o: any) => o.borrower_type === 'STUDENT' && o.borrower_student_id)
      .map((o: any) => o.borrower_student_id)

    const staffIds = overdueOrders
      .filter((o: any) => o.borrower_type === 'STAFF' && o.borrower_staff_id)
      .map((o: any) => o.borrower_staff_id)

    // Fetch student and staff names
    const { data: students } = studentIds.length > 0
      ? await supabaseAdmin.from('students').select('student_id, name').in('student_id', studentIds)
      : { data: [] }

    const { data: staffs } = staffIds.length > 0
      ? await supabaseAdmin.from('staffs').select('staff_id, name').in('staff_id', staffIds)
      : { data: [] }

    // Build lookup maps
    const studentMap = new Map((students || []).map((s: any) => [s.student_id, s.name]))
    const staffMap = new Map((staffs || []).map((s: any) => [s.staff_id, s.name]))

    // Group items by order
    const itemsByOrder = new Map<string, any[]>()
    lendingItems?.forEach((item: any) => {
      if (!itemsByOrder.has(item.lend_order_id)) {
        itemsByOrder.set(item.lend_order_id, [])
      }
      itemsByOrder.get(item.lend_order_id)!.push(item)
    })

    // Build overdue alerts – one alert per product per order
    const overdueAlerts = overdueOrders.flatMap((order: any) => {
      const borrowerName =
        order.borrower_type === 'STUDENT'
          ? studentMap.get(order.borrower_student_id) || 'Unknown Student'
          : staffMap.get(order.borrower_staff_id) || 'Unknown Staff'

      const items = itemsByOrder.get(order.lending_order_id) || []

      return items.map((item: any) => ({
        lending_order_id: order.lending_order_id,
        borrower_name: borrowerName,
        product_name: (item.products as any)?.product_name || 'Unknown Product',
        due_date: order.due_date,
      }))
    })

    return NextResponse.json(overdueAlerts)
  } catch (err: any) {
    console.error('Overdue API error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
