import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin()
    const { id } = await params

    // Fetch product (use * to avoid errors from optional columns like image_url)
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('product_id', id)
      .single()

    if (productError || !product) {
      return NextResponse.json({ error: productError?.message || 'Product not found' }, { status: 404 })
    }

    // Fetch stock separately so a missing column (e.g. damaged_quantity) doesn't fail the main query
    const { data: stockRow } = await supabase
      .from('stocks')
      .select('quantity, damaged_quantity, lost_quantity')
      .eq('product_id', id)
      .maybeSingle()

    const stockData = stockRow
      ? {
          quantity: stockRow.quantity ?? 0,
          damaged_quantity: stockRow.damaged_quantity ?? 0,
          lost_quantity: stockRow.lost_quantity ?? 0,
        }
      : { quantity: 0, damaged_quantity: 0, lost_quantity: 0 }

    const enrichedProduct = { ...product, stocks: stockData }

    // Fetch all lending items for this product to build borrow history
    const { data: lendingItems } = await supabase
      .from('lending_item')
      .select(`
        lend_order_id,
        quantity
      `)
      .eq('product_id', id)

    const orderIds = lendingItems?.map((li: any) => li.lend_order_id) || []

    let borrowingHistory: any[] = []
    let lendingSummary = { totalLent: 0, returned: 0 }

    if (orderIds.length > 0) {
      // Fetch lending orders
      const { data: orders } = await supabase
        .from('lending_order')
        .select(`
          lending_order_id,
          created_at,
          due_date,
          return_date,
          status,
          borrower_type,
          borrower_student_id,
          borrower_staff_id
        `)
        .in('lending_order_id', orderIds)
        .order('created_at', { ascending: false })

      if (orders && orders.length > 0) {
        // Map order id -> lending item quantity
        const qtyByOrder = new Map<string, number>()
        lendingItems?.forEach((li: any) => qtyByOrder.set(li.lend_order_id, li.quantity))

        // Lending summary
        lendingSummary.totalLent = lendingItems?.reduce((s: number, li: any) => s + (li.quantity || 0), 0) || 0
        lendingSummary.returned = orders
          .filter((o: any) => o.status === 'RETURNED')
          .reduce((s: number, o: any) => s + (qtyByOrder.get(o.lending_order_id) || 0), 0)

        // Fetch student names
        const studentIds = [...new Set(orders
          .filter((o: any) => o.borrower_type === 'STUDENT' && o.borrower_student_id)
          .map((o: any) => o.borrower_student_id))]
        
        const staffIds = [...new Set(orders
          .filter((o: any) => o.borrower_type === 'STAFF' && o.borrower_staff_id)
          .map((o: any) => o.borrower_staff_id))]

        const [{ data: students }, { data: staffs }] = await Promise.all([
          studentIds.length > 0
            ? supabase.from('students').select('student_id, name, departments(department_name)').in('student_id', studentIds)
            : Promise.resolve({ data: [] }),
          staffIds.length > 0
            ? supabase.from('staffs').select('staff_id, name').in('staff_id', staffIds)
            : Promise.resolve({ data: [] }),
        ])

        const studentMap = new Map<string, any>((students || []).map((s: any) => [s.student_id, s]))
        const staffMap = new Map<string, any>((staffs || []).map((s: any) => [s.staff_id, s]))

        borrowingHistory = orders.map((order: any, idx: number) => {
          let borrowerName = '—'
          let department = '—'
          let borrowerType = order.borrower_type

          if (order.borrower_type === 'STUDENT' && order.borrower_student_id) {
            const student = studentMap.get(order.borrower_student_id)
            borrowerName = student?.name || '—'
            department = student?.departments?.department_name || '—'
          } else if (order.borrower_type === 'STAFF' && order.borrower_staff_id) {
            const staff = staffMap.get(order.borrower_staff_id)
            borrowerName = staff?.name || '—'
            department = 'Staff'
          }

          return {
            sno: idx + 1,
            lending_order_id: order.lending_order_id,
            borrower_name: borrowerName,
            borrower_type: borrowerType,
            department,
            borrow_date: order.created_at,
            return_date: order.return_date,
            due_date: order.due_date,
            status: order.status,
            quantity: qtyByOrder.get(order.lending_order_id) || 0,
          }
        })
      }
    }

    return NextResponse.json({ product: enrichedProduct, lendingSummary, borrowingHistory })
  } catch (err: any) {
    console.error('Error fetching product detail:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin()
    const { id } = await params
    const body = await request.json()

    const updateData: any = {}
    if (body.product_name !== undefined) updateData.product_name = body.product_name
    if (body.serial_number !== undefined) updateData.serial_number = body.serial_number
    if (body.unit_cost !== undefined) updateData.unit_cost = body.unit_cost
    if (body.low_stock_threshold !== undefined) updateData.low_stock_threshold = body.low_stock_threshold
    if (body.returnable !== undefined) updateData.returnable = body.returnable
    if (body.image_url !== undefined) updateData.image_url = body.image_url

    const { data, error } = await supabase
      .from('products')
      .update(updateData)
      .eq('product_id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin()
    const { id } = await params

    // Delete related lending items first, then stocks, then product
    const { data: lendingItems } = await supabase
      .from('lending_item')
      .select('lend_order_id')
      .eq('product_id', id)

    const orderIds = [...new Set((lendingItems || []).map((li: any) => li.lend_order_id))]

    await supabase.from('lending_item').delete().eq('product_id', id)
    if (orderIds.length > 0) {
      await supabase.from('lending_order').delete().in('lending_order_id', orderIds)
    }
    await supabase.from('stocks').delete().eq('product_id', id)
    const { error } = await supabase.from('products').delete().eq('product_id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
