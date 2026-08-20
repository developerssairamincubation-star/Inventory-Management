import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { REQUEST_ID_HEADER } from '@/lib/logger'

// Edge-safe signature+expiry check only — no DB lookup (is_active, role)
// here, that's still the authoritative check done by requireUser() in
// src/lib/authz.ts on every API route. This exists purely to redirect
// unauthenticated *page* requests before any client JS runs, eliminating the
// flash ProtectedRoute used to cause. It is never sufficient on its own:
// every route must still call requireUser().
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
const PUBLIC_API_PATHS = ['/api/auth/login', '/api/auth/refresh', '/api/health', '/api/sentry-check']

// Security headers live in next.config.ts, not here: Next does not propagate
// response headers set on a middleware's NextResponse to page responses, so
// setting them here left every page unprotected. See the note in
// next.config.ts.
//
// The request id is different — it's forwarded on the *request* headers,
// which routes read via requestIdFrom(), and that does work.

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // One id per request, forwarded to the route on a request header and
  // echoed on the response, so a user-reported failure can be traced through
  // the structured log to the Sentry issue for the same request.
  // Web Crypto, not node:crypto — this runs in the Edge runtime.
  const requestId = req.headers.get(REQUEST_ID_HEADER) || crypto.randomUUID()
  const forwardedHeaders = new Headers(req.headers)
  forwardedHeaders.set(REQUEST_ID_HEADER, requestId)
  const pass = () => NextResponse.next({ request: { headers: forwardedHeaders } })

  // Rate limiting deliberately does NOT live here. It ran in this middleware
  // originally, but the Edge runtime does not persist module state between
  // requests, so the in-process counters reset every time and the limit never
  // fired — verified against a running server. It now runs in the Node
  // runtime, in requireUser() and in the login route. See src/lib/rateLimit.ts.

  if (PUBLIC_PAGE_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return pass()
  }
  if (PUBLIC_API_PATHS.some((p) => pathname === p)) {
    return pass()
  }

  if (await hasValidAccessToken(req)) {
    return pass()
  }

  // The access token is short-lived (15 min); missing or expired here is
  // routine, not a sign-out. `session_hint` (set alongside the refresh token,
  // path=/, carrying no secret — see src/lib/cookies.ts) says the browser
  // still holds a valid refresh token, so let the page render and let the
  // client's authFetch do the silent refresh.
  //
  // This replaces a check for the refresh_token cookie itself, which could
  // never fire: that cookie is scoped to path=/api/auth and browsers simply
  // don't send it to /dashboard. Users were being bounced to /login every 15
  // minutes despite holding a perfectly valid 30-day refresh token.
  //
  // Safe because it grants nothing: every API route still calls requireUser()
  // and returns 401 without a real token, so a forged hint buys a page shell
  // whose every data fetch fails.
  if (req.cookies.get('session_hint')?.value) {
    return pass()
  }

  // API routes answer 401 directly so the client's authFetch can refresh and
  // retry. Page requests fall through to a redirect.
  if (pathname.startsWith('/api/')) {
    const res = NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Please sign in to continue' } },
      { status: 401 },
    )
    res.headers.set(REQUEST_ID_HEADER, requestId)
    return res
  }

  const loginUrl = new URL('/login', req.url)
  loginUrl.searchParams.set('next', pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|images/|Logo.svg).*)'],
}
