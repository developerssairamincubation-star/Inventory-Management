import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api/errors'
import { fromError, created, ok } from '@/lib/api/response'
import getSupabaseAdmin from '@/lib/supabaseServer'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin
      .from('category')
      .select('*')
      .order('category_name', { ascending: true })

    if (error) {
      console.warn('Supabase categories warning:', error.message)
      return ok([])
    }

    return ok(data ?? [])
  } catch (error) {
    return fromError(error)
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const body = await req.json()
    const category_name = body.category_name?.trim()
    if (!category_name) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'category_name is required')
    }
    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin
      .from('category')
      .insert([{ category_name }])
      .select()
      .single()
    if (error) {
      if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
        throw new ApiError(503, 'DEPENDENCY_NOT_READY', 'Category table not set up yet.')
      }
      throw new ApiError(500, 'DATABASE_ERROR', error.message)
    }
    return created(data)
  } catch (error) {
    return fromError(error)
  }
}
