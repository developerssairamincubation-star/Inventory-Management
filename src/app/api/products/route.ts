import { NextResponse } from 'next/server'
import getSupabaseAdmin from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    // Select products with stock information
    const { data, error } = await supabaseAdmin
      .from('products')
      .select(`
        *,
        stocks (quantity),
        product_image (image_url)
      `)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Flatten product_image into image_url field
    const normalized = (data || []).map((p: any) => ({
      ...p,
      image_url: p.product_image?.[0]?.image_url ?? null,
      product_image: undefined,
    }))

    return NextResponse.json(normalized)
  } catch (err: any) {
    console.error('Server error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const supabaseAdmin = getSupabaseAdmin()

    // Map incoming fields to DB schema
    const product_name = body.name ?? body.product_name
    const serial_number = body.sku ?? body.serial_number
    const unit_cost = body.cost ?? body.unit_cost
    const low_stock_threshold = body.low_stock_threshold ?? body.lowStockThreshold ?? null
    // image_url is set after the client uploads to S3 via /api/upload
    const image_url: string | null = body.image_url ?? null
    const returnable = typeof body.returnable === 'boolean' ? body.returnable : null
    const quantity = body.quantity ?? body.initial_quantity ?? null

    // Validate required fields
    if (!product_name || unit_cost == null || quantity == null) {
      return NextResponse.json({ error: 'Missing required fields: product_name, unit_cost, quantity' }, { status: 400 })
    }

    // Generate product_code in format STIC001, STIC002, etc.
    const { data: lastProduct } = await supabaseAdmin
      .from('products')
      .select('product_code')
      .not('product_code', 'is', null)
      .order('product_code', { ascending: false })
      .limit(1)
      .maybeSingle()

    let nextProductNumber = 1
    if (lastProduct && lastProduct.product_code) {
      const lastNumber = parseInt(lastProduct.product_code.replace('STIC', ''))
      if (!isNaN(lastNumber)) {
        nextProductNumber = lastNumber + 1
      }
    }
    const product_code = `STIC${String(nextProductNumber).padStart(3, '0')}`

    // Insert product row (image_url lives in product_image table, not here)
    const { data: product, error: prodErr } = await supabaseAdmin
      .from('products')
      .insert([
        {
          product_code,
          product_name,
          unit_cost,
          serial_number: serial_number ?? undefined,
          low_stock_threshold: low_stock_threshold ?? undefined,
          returnable: returnable ?? undefined,
        },
      ])
      .select()
      .single()

    if (prodErr || !product) {
      console.error('Supabase error (insert product):', prodErr)
      return NextResponse.json({ error: prodErr?.message || 'Failed to create product' }, { status: 500 })
    }

    // Get the product_id from the inserted product
    const product_id = (product as any).product_id ?? (product as any).id
    console.log('Created product with ID:', product_id, 'Full product:', product)

    if (!product_id) {
      console.error('No product_id found in created product:', product)
      return NextResponse.json({ error: 'Failed to retrieve product ID after creation' }, { status: 500 })
    }

    // Insert stock row referencing created product
    const { data: stock, error: stockErr } = await supabaseAdmin
      .from('stocks')
      .insert([
        {
          product_id: product_id,
          quantity: Number(quantity),
        },
      ])
      .select()
      .single()

    if (stockErr) {
      console.error('Supabase error (insert stock):', stockErr)
      // Attempt rollback of created product
      try {
        await supabaseAdmin.from('products').delete().match({ product_id: product_id })
      } catch (delErr) {
        console.error('Failed to rollback product after stock insert failure', delErr)
      }
      return NextResponse.json({ error: stockErr.message || 'Failed to create stock record' }, { status: 500 })
    }

    // Insert into product_image table if an image_url was provided
    if (image_url) {
      const { error: imgErr } = await supabaseAdmin
        .from('product_image')
        .insert([{ product_id, image_url }])
      if (imgErr) {
        console.error('Supabase error (insert product_image):', imgErr)
        // Non-fatal — product and stock already created successfully
      }
    }

    // Return combined result (merge image_url into product for the client)
    return NextResponse.json({ product: { ...product, image_url: image_url ?? null }, stock }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Invalid JSON' }, { status: 400 })
  }
}
