import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { db } from '@/db/client'
import { pruneExpiredSessions } from '@/lib/sessions'
import { fail, fromError, ok } from '@/lib/api/response'
import { logger, requestIdFrom } from '@/lib/logger'

export const dynamic = 'force-dynamic'

// Housekeeping for the sessions table, which nothing ever reaped: with a
// 30-day TTL and rotation on every 15-minute refresh it grew by roughly 2,880
// rows per active user per month, indefinitely.
//
// Authenticated by a shared secret rather than a user session, because the
// caller is a scheduler (Vercel Cron, a systemd timer, or a cron container),
// not a person. Vercel Cron sends its own Authorization: Bearer CRON_SECRET,
// which this accepts too.
function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false

  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  const requestId = requestIdFrom(req)

  if (!authorized(req)) {
    // Same response whether CRON_SECRET is unset or the token is wrong — no
    // reason to tell a prober which it was.
    return fail(404, 'NOT_FOUND', 'Not found')
  }

  try {
    await pruneExpiredSessions(db)
    logger.info('Pruned expired sessions', { requestId, component: 'maintenance' })
    return ok({ pruned: true })
  } catch (error) {
    return fromError(error, { requestId, route: 'POST /api/maintenance/prune-sessions' })
  }
}
