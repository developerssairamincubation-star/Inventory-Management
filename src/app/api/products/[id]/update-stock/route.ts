import { NextRequest, NextResponse } from 'next/server'
import getSupabaseAdmin from '@/lib/supabaseServer'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const { id } = await params
    const body = await request.json()
    const { additionalStock, unitCost, newStock } = body

    const supabaseAdmin = getSupabaseAdmin()

    if (additionalStock !== undefined && (typeof additionalStock !== 'number' || additionalStock < 0)) {
      return NextResponse.json({ error: 'Invalid additional stock value' }, { status: 400 })
    }
    if (newStock !== undefined && (typeof newStock !== 'number' || newStock < 0)) {
      return NextResponse.json({ error: 'Invalid stock value' }, { status: 400 })
    }
    if (unitCost !== undefined && (typeof unitCost !== 'number' || unitCost < 0)) {
      return NextResponse.json({ error: 'Invalid unit cost value' }, { status: 400 })
    }

    // Verify product ownership
    const { data: owned } = await supabaseAdmin
      .from('products')
      .select('product_id')
      .eq('product_id', id)
      .eq('user_id', user.user_id)
      .single()

    if (!owned) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const { data: currentStock, error: stockError } = await supabaseAdmin
      .from('stocks')
      .select('quantity')
      .eq('product_id', id)
      .single()

    if (stockError) {
      return NextResponse.json({ error: stockError.message }, { status: 500 })
    }

    if (newStock !== undefined || additionalStock !== undefined) {
      const newQuantity = newStock !== undefined
        ? newStock
        : (currentStock?.quantity || 0) + (additionalStock as number)

      const { error: updateStockError } = await supabaseAdmin
        .from('stocks')
        .update({ quantity: newQuantity })
        .eq('product_id', id)

      if (updateStockError) {
        return NextResponse.json({ error: updateStockError.message }, { status: 500 })
      }
    }

    if (unitCost !== undefined) {
      const { error: updateCostError } = await supabaseAdmin
        .from('products')
        .update({ unit_cost: unitCost })
        .eq('product_id', id)

      if (updateCostError) {
        return NextResponse.json({ error: updateCostError.message }, { status: 500 })
      }
    }

    const { data: updatedProduct, error: productError } = await supabaseAdmin
      .from('products')
      .select('*, stocks (quantity)')
      .eq('product_id', id)
      .single()

    if (productError) {
      return NextResponse.json({ error: productError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, product: updatedProduct })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update stock' }, { status: 500 })
  }
}
