import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

// Edge-safe signature+expiry check only — no DB lookup (is_active, role)
// here, that's still the authoritative check done by src/lib/authMiddleware.ts
// on every API route. This exists purely to redirect unauthenticated page
// requests before any client JS runs, eliminating the flash ProtectedRoute
// used to cause while it waited on a client-side auth check.
async function hasValidAccessToken(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get('access_token')?.value
  if (!token) return false

  const secret = process.env.JWT_ACCESS_SECRET
  if (!secret) return false

  try {
    await jwtVerify(token, new TextEncoder().encode(secret))
    return true
  } catch {
    return false
  }
}

const PUBLIC_PAGE_PATHS = ['/login']
const PUBLIC_API_PATHS = ['/api/auth/login', '/api/auth/refresh']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_PAGE_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next()
  }
  if (PUBLIC_API_PATHS.some((p) => pathname === p)) {
    return NextResponse.next()
  }

  if (await hasValidAccessToken(req)) {
    return NextResponse.next()
  }

  // The access token is short-lived (15 min) and missing/expired here is
  // routine, not a sign-out — as long as a refresh_token cookie is still
  // present, let the request through. The client-side auth context
  // (fetchAppUser hitting /api/auth/me) detects the 401, silently calls
  // /api/auth/refresh, and retries — no full page redirect needed. Without
  // this check, every user would get bounced to /login on the first page
  // navigation after their access token's 15-minute window, even with a
  // perfectly valid 30-day refresh token.
  if (req.cookies.get('refresh_token')?.value) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const loginUrl = new URL('/login', req.url)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|images/|Logo.svg).*)'],
}
