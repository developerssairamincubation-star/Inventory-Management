import { NextResponse } from 'next/server'
import getSupabaseAdmin from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    // User said "category table"
    const { data, error } = await supabaseAdmin
      .from('category') 
      .select('*')
      
    if (error) {
       console.error('Supabase error categories:', error)
       return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server Error' }, { status: 500 })
  }
}
