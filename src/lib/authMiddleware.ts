import { NextRequest, NextResponse } from 'next/server'
import { verifyFirebaseToken } from '@/lib/firebaseAdmin'
import { getSupabaseAdmin } from '@/lib/supabaseServer'

export type AuthUser = {
  user_id: string
  firebase_uid: string
  email: string
  full_name: string
  role: 'super_admin' | 'user'
  is_active: boolean
}

export type AuthedHandler<T = unknown> = (
  req: NextRequest,
  ctx: { user: AuthUser; params?: T }
) => Promise<NextResponse | Response>

async function getUserFromToken(token: string): Promise<AuthUser | null> {
  try {
    const decoded = await verifyFirebaseToken(token)
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('users')
      .select('user_id, firebase_uid, email, full_name, role, is_active')
      .eq('firebase_uid', decoded.uid)
      .single()

    if (error || !data) return null
    if (!data.is_active) return null

    return data as AuthUser
  } catch {
    return null
  }
}

function extractToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  return auth.slice(7)
}

export function withAuth(handler: AuthedHandler): (req: NextRequest) => Promise<NextResponse | Response>
export function withAuth<T>(handler: AuthedHandler<T>, opts?: { params: T }): (req: NextRequest) => Promise<NextResponse | Response>

export function withAuth(handler: AuthedHandler, opts?: { params?: unknown }) {
  return async (req: NextRequest) => {
    const token = extractToken(req)
    if (!token) {
      return NextResponse.json({ error: 'Missing auth token' }, { status: 401 })
    }

    const user = await getUserFromToken(token)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return handler(req, { user, params: opts?.params })
  }
}

export function withSuperAdmin(handler: AuthedHandler) {
  return withAuth(async (req, ctx) => {
    if (ctx.user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return handler(req, ctx)
  })
}

// Utility: pull token from request and return user — for use inside route handlers
// that need to merge params from Next.js dynamic segments.
export async function getAuthUser(req: NextRequest): Promise<AuthUser | null> {
  const token = extractToken(req)
  if (!token) return null
  return getUserFromToken(token)
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export function forbiddenResponse() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
