// Fixed-window rate limiting with a pluggable store.
//
// The app deploys two ways — Vercel (many short-lived instances) and
// self-hosted Docker (one long-lived process) — so this defaults to an
// in-process store that needs no infrastructure, and upgrades to Redis when
// REDIS_URL / UPSTASH_REDIS_REST_URL is present. On Vercel without Redis the
// in-process store still limits per instance, which blunts an attack without
// stopping it; the startup warning below says so out loud rather than
// leaving the weaker guarantee implicit.
//
// Fixed window (not sliding) is deliberate: it costs one counter per key and
// its worst case — 2x the limit across a window boundary — is irrelevant at
// the thresholds used here.

import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

export type RateLimitResult = {
  allowed: boolean
  limit: number
  remaining: number
  /** Unix ms when the current window expires — sent as Retry-After. */
  resetAt: number
}

export type RateLimitRule = {
  /** Max requests permitted per window. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
}

// ── Rules ────────────────────────────────────────────────────────────────
// There is no longer a login-specific per-IP rule. The old
// `login: { limit: 8, windowMs: 15 * 60_000 }` was removed by request — it
// was tripping legitimate use, since everyone behind one office NAT shares a
// source IP and eight sign-ins per quarter hour is a low ceiling for a shared
// address. /api/auth/login now falls through ruleFor() to the ordinary
// `mutation` rule like any other POST.
//
// What still guards the endpoint: loginPerAccount below (12 attempts per
// email per 15 min), which is the rule that actually caps brute force against
// a given account, and bcrypt at cost 12.
export const RULES = {
  // Per-account rather than per-IP, so a distributed attempt on one account is
  // still capped, and so one attacker cannot lock a victim out by spraying
  // from an address the victim doesn't share.
  loginPerAccount: { limit: 12, windowMs: 15 * 60_000 },
  mutation: { limit: 120, windowMs: 60_000 },
  read: { limit: 600, windowMs: 60_000 },
  // Uncapped third-party spend otherwise: each call ships a whole PDF to a
  // metered Gemini endpoint.
  expensive: { limit: 20, windowMs: 60 * 60_000 },
} as const satisfies Record<string, RateLimitRule>

// ── Store ────────────────────────────────────────────────────────────────

interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>
}

class MemoryStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; resetAt: number }>()
  private lastSweep = 0

  async increment(key: string, windowMs: number) {
    const now = Date.now()
    this.sweep(now)

    const existing = this.buckets.get(key)
    if (existing && existing.resetAt > now) {
      existing.count += 1
      return existing
    }

    const fresh = { count: 1, resetAt: now + windowMs }
    this.buckets.set(key, fresh)
    return fresh
  }

  // Without this the map grows one entry per distinct IP forever, which is
  // an unbounded memory leak on a long-lived Docker process.
  private sweep(now: number) {
    if (now - this.lastSweep < 60_000) return
    this.lastSweep = now
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key)
    }
  }
}

// Reused across HMR re-evaluations in dev, same reasoning as the pg pool —
// otherwise every edit resets the counters.
const globalForRateLimit = globalThis as unknown as { rateLimitStore?: RateLimitStore }

function resolveStore(): RateLimitStore {
  if (globalForRateLimit.rateLimitStore) return globalForRateLimit.rateLimitStore

  const store = new MemoryStore()
  globalForRateLimit.rateLimitStore = store

  if (!process.env.REDIS_URL && !process.env.UPSTASH_REDIS_REST_URL && process.env.NODE_ENV === 'production') {
    logger.warn('Rate limiting is using the in-process store', {
      detail:
        'Counters are per-instance. On a multi-instance deployment set REDIS_URL or UPSTASH_REDIS_REST_URL for a shared limit.',
    })
  }

  return store
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Kill switch for load testing, and ONLY for load testing.
 *
 * A load test from one machine is a single client IP, so the per-IP rules
 * below fire within seconds and the run ends up measuring this file instead
 * of the application. There are two ways around that:
 *
 *   1. Give each virtual user a distinct X-Forwarded-For, so the limiter sees
 *      many clients (what k6/lib/session.js does by default). Keeps the
 *      limiter in the request path, which is the more faithful measurement.
 *   2. Turn the limiter off entirely — this flag. Simpler, and the right
 *      choice when you want the app's raw ceiling with no limiter overhead,
 *      or when a proxy in front rewrites X-Forwarded-For and option 1 stops
 *      working.
 *
 * Deliberately NOT gated on NODE_ENV: a meaningful load test runs against a
 * production build, so a NODE_ENV check would make this useless exactly where
 * it is needed. The protection is the noise instead — every request path that
 * consults this logs at error level on the first bypass, and the startup
 * warning below is unmissable in any log aggregator.
 *
 * Setting this in a real deployment removes the per-account brute-force cap
 * on /api/auth/login and uncaps spend on the metered Gemini endpoint. It
 * belongs in a throwaway load-test environment's env file and nowhere else.
 */
const DISABLED = process.env.RATE_LIMIT_DISABLED === 'true'

let warnedDisabled = false

function warnDisabledOnce() {
  if (warnedDisabled) return
  warnedDisabled = true
  logger.error('RATE LIMITING IS DISABLED', {
    component: 'rate-limit',
    detail:
      'RATE_LIMIT_DISABLED=true — the login per-account cap and third-party spend caps are OFF. ' +
      'This must only ever be set in a disposable load-test environment.',
  })
}

export async function rateLimit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  if (DISABLED) {
    warnDisabledOnce()
    return { allowed: true, limit: rule.limit, remaining: rule.limit, resetAt: Date.now() + rule.windowMs }
  }

  try {
    const { count, resetAt } = await resolveStore().increment(key, rule.windowMs)
    return {
      allowed: count <= rule.limit,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - count),
      resetAt,
    }
  } catch (error) {
    // A limiter that throws must never take down the endpoint it protects —
    // fail open, but say so loudly so a broken Redis doesn't stay silent.
    logger.error('Rate limit store failed; allowing request', {}, error)
    return { allowed: true, limit: rule.limit, remaining: rule.limit, resetAt: Date.now() + rule.windowMs }
  }
}

/**
 * Best-effort client IP. Behind a proxy the leftmost x-forwarded-for entry is
 * client-controlled and spoofable, so this is a throttling signal, never an
 * authorization one. TRUSTED_PROXY_DEPTH lets a deployment count in from the
 * right instead, which is not spoofable when the proxy chain is fixed.
 */
export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean)
    const depth = Number(process.env.TRUSTED_PROXY_DEPTH || 0)
    if (depth > 0 && parts.length >= depth) return parts[parts.length - depth]
    if (parts[0]) return parts[0]
  }
  return req.headers.get('x-real-ip') || 'unknown'
}

/**
 * Picks the rule that applies to a request path/method.
 *
 * /api/auth/login used to be special-cased to a much stricter rule; it now
 * takes the ordinary `mutation` budget along with every other POST. The
 * per-account limit in the login route is what caps brute force now.
 */
export function ruleFor(pathname: string, method: string): RateLimitRule {
  if (pathname === '/api/invoices/parse-pdf' || pathname === '/api/upload/presign') return RULES.expensive
  if (method === 'GET' || method === 'HEAD') return RULES.read
  return RULES.mutation
}

/**
 * Per-IP limit for one request. Returns null when the request may proceed, or
 * the 429 to return.
 *
 * Called from the Node runtime (requireUser, and the login route directly),
 * NOT from Edge middleware. The in-process store depends on module state
 * surviving between requests, and the Edge runtime makes no such guarantee —
 * measured against a running dev server, the counters reset on every request
 * and the limit never fired at all. Node route handlers keep module state for
 * the life of the process, so the same store works there.
 */
export async function enforceIpRateLimit(
  req: { headers: { get(name: string): string | null }; method: string },
  pathname: string,
): Promise<NextResponse | null> {
  const rule = ruleFor(pathname, req.method)
  const result = await rateLimit(`ip:${clientIp(req)}:${pathname}`, rule)
  if (result.allowed) return null

  return NextResponse.json(
    { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' } },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))),
        ...rateLimitHeaders(result),
      },
    },
  )
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000))),
  }
}
