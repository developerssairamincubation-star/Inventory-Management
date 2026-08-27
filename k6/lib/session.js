// Authenticated HTTP for k6 VUs.
//
// Mirrors what src/lib/authFetch on the client actually does, because the
// server enforces all of it:
//
//  - cookie auth (access_token httpOnly, refresh_token scoped to /api/auth,
//    session_hint, csrf_token) — src/lib/cookies.ts
//  - a double-submit CSRF header on every POST/PUT/PATCH/DELETE, compared
//    against the csrf_token cookie — src/lib/authz.ts csrfPassed()
//  - a silent refresh + single retry on 401, because the access token
//    expires after 15 minutes and a soak test outlives that
//
// Getting any of these wrong produces a test that looks like it is hammering
// the app while actually measuring a 401/403 path that never touches the
// database.

import http from 'k6/http'
import exec from 'k6/execution'
import { check } from 'k6'
import {
  BASE_URL,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  USER_COUNT,
  USER_EMAIL_TEMPLATE,
  USER_PASSWORD,
  SPOOF_CLIENT_IP,
} from './config.js'
import { rateLimited, tokenRefreshes, authFailures, serverErrors } from './metrics.js'

// One jar per VU, created at init time so it survives across iterations.
// k6 resets the *default* VU jar between iterations; an explicit jar does
// not, and a session that re-logs-in every iteration would burn through
// RULES.login (8 per IP per 15 min) in seconds.
const jar = new http.CookieJar()

let loggedIn = false
let identity = null

/**
 * A stable per-VU source IP.
 *
 * src/lib/rateLimit.ts clientIp() reads the leftmost x-forwarded-for entry,
 * so this makes each VU a distinct client for limiting purposes. It is a
 * throttling signal only — the app never authorizes on it (the comment in
 * clientIp() says so), so this cannot grant a VU anything it should not have.
 */
function vuAddress() {
  const id = exec.vu.idInTest
  return `10.${(id >> 16) & 255}.${(id >> 8) & 255}.${id & 255}`
}

function baseHeaders() {
  const h = { 'User-Agent': `k6-inventory-perf/1.0 (vu=${exec.vu.idInTest})` }
  if (SPOOF_CLIENT_IP) h['X-Forwarded-For'] = vuAddress()
  return h
}

function csrfToken() {
  const cookies = jar.cookiesForURL(`${BASE_URL}/`)
  const values = cookies['csrf_token']
  return values && values.length ? values[0] : null
}

/**
 * Which seeded account this VU uses. Spreads VUs over the pool.
 *
 * setup() and teardown() run outside any VU, where idInTest is 0 — hence the
 * clamp. That deliberately makes setup use pool account 0 rather than the
 * admin: the fixtures it creates are owned by that account, and authorization
 * is COE-scoped (src/lib/authz.ts), so fixtures created by an admin with no
 * domain would be invisible to every domain-assigned VU. Setup must stand
 * inside the same tenancy boundary as the VUs it is preparing data for.
 */
export function credentialsForVU() {
  if (USER_COUNT <= 0) return { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
  const index = Math.max(0, exec.vu.idInTest - 1) % USER_COUNT
  return {
    email: USER_EMAIL_TEMPLATE.replace('{i}', String(index)),
    password: USER_PASSWORD,
  }
}

/**
 * POST /api/auth/login. Deliberately NOT rate-limit-tolerant: if this 429s,
 * the run is misconfigured (too many VUs per seeded account, or IP spoofing
 * off) and silently continuing would produce a meaningless result.
 */
export function login(email, password) {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password }),
    {
      jar,
      headers: { ...baseHeaders(), 'Content-Type': 'application/json' },
      tags: { endpoint: 'login', flow: 'auth' },
    },
  )

  if (res.status === 429) {
    rateLimited.add(1, { endpoint: 'login' })
    console.error(
      `login 429 for ${email} — per-IP limit is 8/15min and per-account 12/15min. ` +
        `Seed more accounts (PERF_USER_COUNT) or keep PERF_SPOOF_CLIENT_IP=true.`,
    )
    return null
  }

  if (res.status !== 200) {
    authFailures.add(1)
    console.error(`login failed for ${email}: ${res.status} ${String(res.body).slice(0, 200)}`)
    return null
  }

  return res.json()
}

/** Logs this VU in once, on its first iteration. */
export function ensureSession() {
  if (loggedIn) return identity
  const { email, password } = credentialsForVU()
  identity = login(email, password)
  loggedIn = identity !== null
  return identity
}

/** POST /api/auth/refresh — rotates the refresh token and mints a new access token. */
function refresh() {
  const res = http.post(`${BASE_URL}/api/auth/refresh`, null, {
    jar,
    headers: baseHeaders(),
    tags: { endpoint: 'refresh', flow: 'auth' },
  })
  if (res.status === 200) {
    tokenRefreshes.add(1)
    return true
  }
  return false
}

/**
 * The one request helper every flow uses.
 *
 * @param method  HTTP verb
 * @param path    path under BASE_URL, e.g. '/api/products'
 * @param body    object (JSON-encoded) or null
 * @param opts    { endpoint, flow, expect, allow404 }
 *                `endpoint` is the metric tag — always a constant, never a
 *                path with an id in it, or every URL becomes its own metric.
 */
export function authFetch(method, path, body, opts = {}) {
  const { endpoint = 'unknown', flow = 'unknown', expect = [200, 201, 204], allow404 = false } = opts

  const send = () => {
    const headers = { ...baseHeaders() }
    if (body !== null && body !== undefined) headers['Content-Type'] = 'application/json'

    // Mutating verbs must echo the csrf cookie back as a header, or
    // requireUser() rejects with 403 CSRF_FAILED before touching the DB.
    if (method !== 'GET' && method !== 'HEAD') {
      const token = csrfToken()
      if (token) headers['X-CSRF-Token'] = token
    }

    return http.request(method, `${BASE_URL}${path}`, body === null || body === undefined ? null : JSON.stringify(body), {
      jar,
      headers,
      tags: { endpoint, flow, name: endpoint },
    })
  }

  let res = send()

  // 401 here is routine after 15 minutes, not a sign-out — same reasoning as
  // the client's authFetch. One refresh, one retry, then give up.
  if (res.status === 401) {
    if (refresh()) {
      res = send()
    } else {
      authFailures.add(1)
    }
  }

  if (res.status === 429) rateLimited.add(1, { endpoint })
  if (res.status >= 500) serverErrors.add(1, { endpoint })

  const acceptable = allow404 ? expect.concat([404]) : expect
  const okStatus = acceptable.indexOf(res.status) !== -1

  check(res, {
    [`${endpoint} -> ${acceptable.join('/')}`]: () => okStatus,
  })

  if (!okStatus && res.status !== 429) {
    // One line, truncated: a stress test that starts failing must not turn
    // into gigabytes of console output.
    console.warn(`${method} ${path} -> ${res.status} ${String(res.body).slice(0, 160)}`)
  }

  return res
}

export const get = (path, opts) => authFetch('GET', path, null, opts)
export const post = (path, body, opts) => authFetch('POST', path, body, opts)
export const patch = (path, body, opts) => authFetch('PATCH', path, body, opts)
export const del = (path, opts) => authFetch('DELETE', path, null, opts)

/** Parsed JSON body, or null when the response was not usable. */
export function json(res) {
  if (!res || res.status >= 400) return null
  try {
    return res.json()
  } catch {
    return null
  }
}

export { jar, baseHeaders, vuAddress }
