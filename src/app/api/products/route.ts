import { NextRequest, NextResponse } from 'next/server'
import getSupabaseAdmin from '@/lib/supabaseServer'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin
      .from('products')
      .select(`
        *,
        stocks (quantity),
        product_image (image_url)
      `)
      .eq('user_id', user.user_id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const categoryIds = [...new Set((data || []).map((p: any) => p.category_id).filter(Boolean))]
    const categoryMap: Record<string, string> = {}
    if (categoryIds.length > 0) {
      try {
        const { data: cats } = await supabaseAdmin
          .from('category')
          .select('category_id, category_name')
          .in('category_id', categoryIds)
        ;(cats || []).forEach((c: any) => { categoryMap[c.category_id] = c.category_name })
      } catch { /* category table may not exist yet */ }
    }

    const normalized = (data || []).map((p: any) => ({
      ...p,
      image_url: p.product_image?.[0]?.image_url ?? null,
      product_image: undefined,
      category_name: p.category_id ? (categoryMap[p.category_id] ?? null) : null,
    }))

    return NextResponse.json(normalized)
  } catch (err: any) {
    console.error('Server error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const body = await req.json()
    const supabaseAdmin = getSupabaseAdmin()

    const product_name = body.name ?? body.product_name
    const serial_number = body.sku ?? body.serial_number
    const unit_cost = body.cost ?? body.unit_cost
    const low_stock_threshold = body.low_stock_threshold ?? body.lowStockThreshold ?? null
    const image_url: string | null = body.image_url ?? null
    // Determine `returnable` / `consumable` only when provided or derivable.
    // If neither is provided, leave them undefined so DB defaults apply.
    const hasReturnable = typeof body.returnable === 'boolean'
    const hasConsumable = typeof body.consumable === 'boolean'
    let returnable: boolean | undefined = undefined
    let consumable: boolean | undefined = undefined
    if (hasReturnable) {
      returnable = body.returnable
    }
    if (hasConsumable) {
      consumable = body.consumable
    }
    // If only consumable provided, derive returnable as inverse
    if (!hasReturnable && hasConsumable) {
      returnable = !body.consumable
    }
    const quantity = body.quantity ?? body.initial_quantity ?? null
    const category_id = body.category_id ?? null

    if (!product_name || unit_cost == null || quantity == null) {
      return NextResponse.json({ error: 'Missing required fields: product_name, unit_cost, quantity' }, { status: 400 })
    }

    // Product code is globally sequential to avoid conflicts
    const { data: lastProduct } = await supabaseAdmin
      .from('products')
      .select('product_code')
      .not('product_code', 'is', null)
      .order('product_code', { ascending: false })
      .limit(1)
      .maybeSingle()

    let nextProductNumber = 1
    if (lastProduct?.product_code) {
      const lastNumber = parseInt(lastProduct.product_code.replace('STIC', ''))
      if (!isNaN(lastNumber)) nextProductNumber = lastNumber + 1
    }
    const product_code = `STIC${String(nextProductNumber).padStart(3, '0')}`

    const insertData: any = {
      product_code,
      product_name,
      unit_cost,
      user_id: user.user_id,
    }
    if (consumable !== undefined) insertData.consumable = consumable
    if (returnable !== undefined) insertData.returnable = returnable
    if (serial_number) insertData.serial_number = serial_number
    if (low_stock_threshold !== null && low_stock_threshold !== undefined) insertData.low_stock_threshold = low_stock_threshold
    if (category_id) insertData.category_id = category_id

    const { data: product, error: prodErr } = await supabaseAdmin
      .from('products')
      .insert([insertData])
      .select()
      .single()

    if (prodErr || !product) {
      return NextResponse.json({ error: prodErr?.message || 'Failed to create product' }, { status: 500 })
    }

    const product_id = (product as any).product_id ?? (product as any).id
    if (!product_id) {
      return NextResponse.json({ error: 'Failed to retrieve product ID after creation' }, { status: 500 })
    }

    const { data: stock, error: stockErr } = await supabaseAdmin
      .from('stocks')
      .insert([{ product_id, quantity: Number(quantity) }])
      .select()
      .single()

    if (stockErr) {
      await supabaseAdmin.from('products').delete().match({ product_id })
      return NextResponse.json({ error: stockErr.message || 'Failed to create stock record' }, { status: 500 })
    }

    if (image_url) {
      const { error: imgErr } = await supabaseAdmin
        .from('product_image')
        .insert([{ product_id, image_url }])
        .select()
      if (imgErr) console.error('Supabase error (insert product_image):', imgErr)
    }

    return NextResponse.json({ product: { ...product, image_url: image_url ?? null }, stock }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Invalid JSON' }, { status: 400 })
  }
}
