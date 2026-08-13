import { NextResponse } from 'next/server'
import { ACCESS_TOKEN_TTL_MS } from './jwt'

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const CSRF_TOKEN_TTL_MS = ACCESS_TOKEN_TTL_MS // reissued alongside the access token every refresh

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
  // Deliberately NOT httpOnly — the client reads this and echoes it back as
  // the X-CSRF-Token header (double-submit cookie pattern).
  res.cookies.set('csrf_token', opts.csrfToken, {
    httpOnly: false,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(CSRF_TOKEN_TTL_MS / 1000),
  })
}

export function clearAuthCookies(res: NextResponse) {
  res.cookies.set('access_token', '', { httpOnly: true, secure: isProd(), sameSite: 'lax', path: '/', maxAge: 0 })
  res.cookies.set('refresh_token', '', { httpOnly: true, secure: isProd(), sameSite: 'lax', path: '/api/auth', maxAge: 0 })
  res.cookies.set('csrf_token', '', { httpOnly: false, secure: isProd(), sameSite: 'lax', path: '/', maxAge: 0 })
}
