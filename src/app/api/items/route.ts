import { NextResponse } from 'next/server'
import getSupabaseAdmin from '@/lib/supabaseServer'

// GET /api/items - list all items
export async function GET() {
  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin.from('items').select('*').order('id', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/items - create an item
export async function POST(req: Request) {
  try {
    const body = await req.json()
    // expected body: { name: string, quantity?: number }
    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin.from('items').insert([body]).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json(data, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Invalid JSON' }, { status: 400 })
  }
}
