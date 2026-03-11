import { NextRequest, NextResponse } from 'next/server'
import getSupabaseAdmin from '@/lib/supabaseServer'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { additionalStock, unitCost, newStock } = body

    const supabaseAdmin = getSupabaseAdmin()

    // Validate inputs
    if (additionalStock !== undefined && (typeof additionalStock !== 'number' || additionalStock < 0)) {
      return NextResponse.json({ error: 'Invalid additional stock value' }, { status: 400 })
    }

    if (newStock !== undefined && (typeof newStock !== 'number' || newStock < 0)) {
      return NextResponse.json({ error: 'Invalid stock value' }, { status: 400 })
    }

    if (unitCost !== undefined && (typeof unitCost !== 'number' || unitCost < 0)) {
      return NextResponse.json({ error: 'Invalid unit cost value' }, { status: 400 })
    }

    // Get current stock
    const { data: currentStock, error: stockError } = await supabaseAdmin
      .from('stocks')
      .select('quantity')
      .eq('product_id', id)
      .single()

    if (stockError) {
      console.error('Error fetching current stock:', stockError)
      return NextResponse.json({ error: stockError.message }, { status: 500 })
    }

    // Update stock quantity — either set absolute value (newStock) or add delta (additionalStock)
    if (newStock !== undefined || additionalStock !== undefined) {
      const newQuantity = newStock !== undefined
        ? newStock
        : (currentStock?.quantity || 0) + (additionalStock as number)

      const { error: updateStockError } = await supabaseAdmin
        .from('stocks')
        .update({ quantity: newQuantity })
        .eq('product_id', id)

      if (updateStockError) {
        console.error('Error updating stock:', updateStockError)
        return NextResponse.json({ error: updateStockError.message }, { status: 500 })
      }
    }

    // Update unit cost if provided
    if (unitCost !== undefined) {
      const { error: updateCostError } = await supabaseAdmin
        .from('products')
        .update({ unit_cost: unitCost })
        .eq('product_id', id)

      if (updateCostError) {
        console.error('Error updating unit cost:', updateCostError)
        return NextResponse.json({ error: updateCostError.message }, { status: 500 })
      }
    }

    // Fetch updated data
    const { data: updatedProduct, error: productError } = await supabaseAdmin
      .from('products')
      .select(`
        *,
        stocks (quantity)
      `)
      .eq('product_id', id)
      .single()

    if (productError) {
      console.error('Error fetching updated product:', productError)
      return NextResponse.json({ error: productError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      product: updatedProduct
    })
  } catch (error) {
    console.error('Error in update stock:', error)
    return NextResponse.json(
      { error: 'Failed to update stock' },
      { status: 500 }
    )
  }
}
