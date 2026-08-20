import { NextResponse } from 'next/server'
import { ACCESS_TOKEN_TTL_MS } from './jwt'

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function isProd() {
  return process.env.NODE_ENV === 'production'
}

export function setAuthCookies(
  res: NextResponse,
  opts: { accessToken: string; refreshToken: string; csrfToken: string }
) {
  res.cookies.set('access_token', opts.accessToken, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
  })

  // Scoped to /api/auth so it's never sent on ordinary API/page requests,
  // shrinking its exposure surface — only auth endpoints ever need it.
  res.cookies.set('refresh_token', opts.refreshToken, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: Math.floor(REFRESH_TOKEN_TTL_MS / 1000),
  })

  // Carries no secret: it only tells the Edge middleware "this browser holds
  // a refresh token", so a page navigation after the 15-minute access-token
  // window renders instead of bouncing to /login. The middleware used to
  // check for refresh_token itself, which could never work — that cookie is
  // path-scoped to /api/auth and is simply not sent to /dashboard. Widening
  // the refresh token's path would have fixed the redirect at the cost of
  // exposing the credential on every request; this hint achieves the same
  // thing while leaving the real token scoped. It grants nothing on its own:
  // every API call still requires a valid access token, and forging this
  // cookie only gets you a page shell whose data fetches all return 401.
  res.cookies.set('session_hint', '1', {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(REFRESH_TOKEN_TTL_MS / 1000),
  })

  // Deliberately NOT httpOnly — the client reads this and echoes it back as
  // the X-CSRF-Token header (double-submit cookie pattern).
  //
  // Lifetime matches the refresh token, not the access token. When it
  // expired on the access token's 15-minute clock, the first mutating
  // request after expiry sent no CSRF header at all and was rejected — and
  // authFetch's retry re-sent the same header-less request, so the user saw
  // a spurious failure and had to click twice.
  res.cookies.set('csrf_token', opts.csrfToken, {
    httpOnly: false,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(REFRESH_TOKEN_TTL_MS / 1000),
  })
}

export function clearAuthCookies(res: NextResponse) {
  res.cookies.set('access_token', '', { httpOnly: true, secure: isProd(), sameSite: 'lax', path: '/', maxAge: 0 })
  res.cookies.set('refresh_token', '', { httpOnly: true, secure: isProd(), sameSite: 'lax', path: '/api/auth', maxAge: 0 })
  res.cookies.set('session_hint', '', { httpOnly: true, secure: isProd(), sameSite: 'lax', path: '/', maxAge: 0 })
  res.cookies.set('csrf_token', '', { httpOnly: false, secure: isProd(), sameSite: 'lax', path: '/', maxAge: 0 })
}
