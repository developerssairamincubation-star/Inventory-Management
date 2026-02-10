import { NextResponse } from 'next/server'
import getSupabaseAdmin from '@/lib/supabaseServer'

// GET /api/items/:id
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id)
  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin.from('items').select('*').eq('id', id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

// PATCH /api/items/:id - update partial
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id)
    const body = await req.json()
    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin.from('items').update(body).eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Invalid JSON' }, { status: 400 })
  }
}

// DELETE /api/items/:id
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id)
  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin.from('items').delete().eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true, deleted: data })
}
