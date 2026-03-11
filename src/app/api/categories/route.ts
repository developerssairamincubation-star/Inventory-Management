import { NextResponse } from 'next/server'
import getSupabaseAdmin from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin
      .from('category') 
      .select('*')
      .order('category_name', { ascending: true })
      
    if (error) {
      // Table may not exist yet — return empty array rather than 500
      console.warn('Supabase categories warning:', error.message)
      return NextResponse.json([])
    }
    
    return NextResponse.json(data ?? [])
  } catch (err: any) {
    return NextResponse.json([])
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const category_name = body.category_name?.trim()
    if (!category_name) {
      return NextResponse.json({ error: 'category_name is required' }, { status: 400 })
    }
    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin
      .from('category')
      .insert([{ category_name }])
      .select()
      .single()
    if (error) {
      console.error('Supabase error creating category:', error)
      // Friendly message if table not yet created
      if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
        return NextResponse.json({ error: 'Category table not set up yet. Please run the DB migration first.' }, { status: 503 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json(data, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server Error' }, { status: 500 })
  }
}
