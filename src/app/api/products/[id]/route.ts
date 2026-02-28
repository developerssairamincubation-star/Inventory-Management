import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin()
    const { id } = await params

    // Extract period query param for lending summary filtering
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || 'monthly'

    const now = new Date()
    let fromDate: Date
    switch (period) {
      case 'daily':
        fromDate = new Date(now)
        fromDate.setHours(0, 0, 0, 0)
        break
      case 'weekly':
        fromDate = new Date(now)
        fromDate.setDate(now.getDate() - 7)
        break
      case 'yearly':
        fromDate = new Date(now)
        fromDate.setFullYear(now.getFullYear() - 1)
        break
      case 'monthly':
      default:
        fromDate = new Date(now)
        fromDate.setMonth(now.getMonth() - 1)
        break
    }

    // Fetch product (exclude image_url — it lives in product_image table)
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('product_id', id)
      .single()

    if (productError || !product) {
      return NextResponse.json({ error: productError?.message || 'Product not found' }, { status: 404 })
    }

    // Fetch image_url from product_image table
    const { data: productImage } = await supabase
      .from('product_image')
      .select('image_url')
      .eq('product_id', id)
      .maybeSingle()

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

    // Merge image_url into product
    const enrichedProduct = {
      ...product,
      image_url: productImage?.image_url ?? null,
      stocks: stockData,
    }

    // Fetch all lending items for this product (with damaged/lost quantities)
    const { data: lendingItems } = await supabase
      .from('lending_item')
      .select(`
        lend_order_id,
        quantity,
        original_quantity,
        damaged_quantity,
        lost_quantity
      `)
      .eq('product_id', id)

    const orderIds = lendingItems?.map((li: any) => li.lend_order_id) || []

    let borrowingHistory: any[] = []
    let lendingSummary = { totalLent: 0, returned: 0 }

    if (orderIds.length > 0) {
      // Fetch lending orders (including mentor_staff_id)
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
          borrower_staff_id,
          mentor_staff_id
        `)
        .in('lending_order_id', orderIds)
        .order('created_at', { ascending: false })

      if (orders && orders.length > 0) {
        // Maps: order id -> lending item fields
        const qtyByOrder = new Map<string, number>()
        const origQtyByOrder = new Map<string, number>()
        const damagedByOrder = new Map<string, number>()
        const lostByOrder = new Map<string, number>()
        lendingItems?.forEach((li: any) => {
          const currentQty = li.quantity ?? 0
          // original_quantity may not exist if migration hasn't run — fall back to current quantity
          const origQty = (li.original_quantity != null && li.original_quantity > 0)
            ? li.original_quantity
            : currentQty
          qtyByOrder.set(li.lend_order_id, currentQty)
          origQtyByOrder.set(li.lend_order_id, origQty)
          damagedByOrder.set(li.lend_order_id, li.damaged_quantity ?? 0)
          lostByOrder.set(li.lend_order_id, li.lost_quantity ?? 0)
        })

        // Period-filtered lending summary
        const ordersInPeriod = orders.filter((o: any) => new Date(o.created_at) >= fromDate)
        // totalLent = sum of original quantities borrowed (not the current balance)
        lendingSummary.totalLent = ordersInPeriod.reduce(
          (s: number, o: any) => s + (origQtyByOrder.get(o.lending_order_id) || 0),
          0
        )
        // returned = for returned orders: original - damaged - lost (i.e. physically returned good items)
        lendingSummary.returned = ordersInPeriod
          .filter((o: any) => ['RETURNED', 'RETURNED_DAMAGED', 'RETURNED_LOST'].includes(o.status))
          .reduce((s: number, o: any) => {
            const orig = origQtyByOrder.get(o.lending_order_id) || 0
            const dmg  = damagedByOrder.get(o.lending_order_id) || 0
            const lst  = lostByOrder.get(o.lending_order_id) || 0
            return s + Math.max(0, orig - dmg - lst)
          }, 0)

        // Collect all person + mentor IDs
        const studentIds = [...new Set(orders
          .filter((o: any) => o.borrower_type === 'STUDENT' && o.borrower_student_id)
          .map((o: any) => o.borrower_student_id))]

        const staffIds = [...new Set(orders
          .filter((o: any) => o.borrower_type === 'STAFF' && o.borrower_staff_id)
          .map((o: any) => o.borrower_staff_id))]

        const mentorIds = [...new Set(orders
          .filter((o: any) => o.mentor_staff_id)
          .map((o: any) => o.mentor_staff_id))]

        const allStaffIds = [...new Set([...staffIds, ...mentorIds])]

        const [{ data: students }, { data: allStaffs }] = await Promise.all([
          studentIds.length > 0
            ? supabase.from('students').select('student_id, name, departments(department_name)').in('student_id', studentIds)
            : Promise.resolve({ data: [] }),
          allStaffIds.length > 0
            ? supabase.from('staffs').select('staff_id, name').in('staff_id', allStaffIds)
            : Promise.resolve({ data: [] }),
        ])

        const studentMap = new Map<string, any>((students || []).map((s: any) => [s.student_id, s]))
        const staffMap = new Map<string, any>((allStaffs || []).map((s: any) => [s.staff_id, s]))

        borrowingHistory = orders.map((order: any, idx: number) => {
          let borrowerName = '—'
          let department = '—'
          const borrowerType = order.borrower_type

          if (order.borrower_type === 'STUDENT' && order.borrower_student_id) {
            const student = studentMap.get(order.borrower_student_id)
            borrowerName = student?.name || '—'
            department = student?.departments?.department_name || '—'
          } else if (order.borrower_type === 'STAFF' && order.borrower_staff_id) {
            const staff = staffMap.get(order.borrower_staff_id)
            borrowerName = staff?.name || '—'
            department = 'Staff'
          }

          const mentor = order.mentor_staff_id
            ? (staffMap.get(order.mentor_staff_id)?.name || '—')
            : '—'

          const currentQty = qtyByOrder.get(order.lending_order_id) ?? 0
          const originalQty = origQtyByOrder.get(order.lending_order_id) ?? currentQty
          const damagedQty = damagedByOrder.get(order.lending_order_id) || 0
          const lostQty = lostByOrder.get(order.lending_order_id) || 0

          const FINAL_STATUSES = ['RETURNED', 'RETURNED_DAMAGED', 'RETURNED_LOST', 'DAMAGED', 'LOST', 'CONSUMABLE']
          const isFullyReturned = FINAL_STATUSES.includes(order.status)
          const remainingQty = isFullyReturned ? 0 : currentQty

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
            quantity: remainingQty,
            original_quantity: originalQty,
            damaged_quantity: damagedQty,
            lost_quantity: lostQty,
            mentor,
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
    // image_url is NOT a column on products — handled separately via product_image table

    const { data, error } = await supabase
      .from('products')
      .update(updateData)
      .eq('product_id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Upsert image_url in product_image table if provided
    let returnedImageUrl: string | null = null
    if (body.image_url !== undefined) {
      const { data: existing } = await supabase
        .from('product_image')
        .select('image_url')
        .eq('product_id', id)
        .maybeSingle()

      if (existing) {
        await supabase
          .from('product_image')
          .update({ image_url: body.image_url })
          .eq('product_id', id)
      } else {
        await supabase
          .from('product_image')
          .insert([{ product_id: id, image_url: body.image_url }])
      }
      returnedImageUrl = body.image_url
    } else {
      // Fetch existing image_url to return it
      const { data: img } = await supabase
        .from('product_image')
        .select('image_url')
        .eq('product_id', id)
        .maybeSingle()
      returnedImageUrl = img?.image_url ?? null
    }

    return NextResponse.json({ ...data, image_url: returnedImageUrl })
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
