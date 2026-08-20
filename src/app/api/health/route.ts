import { NextResponse } from 'next/server'
import { pingDatabase } from '@/db/client'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

// Liveness + readiness for orchestrators and the Docker HEALTHCHECK. Without
// this, nothing upstream could tell a healthy process from one wedged on a
// dead database — a container with no working DB still answered every page
// request with a 500 and stayed "up" forever.
//
// Deliberately unauthenticated (see PUBLIC_API_PATHS in middleware.ts) and
// deliberately terse: it reports reachability, never versions, connection
// strings, or error detail that would help someone probing the deployment.
export async function GET() {
  const startedAt = Date.now()

  try {
    await pingDatabase()
    return NextResponse.json(
      { status: 'ok', database: 'ok', latencyMs: Date.now() - startedAt },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    logger.error('Health check failed', { component: 'health' }, error)
    return NextResponse.json(
      { status: 'degraded', database: 'unreachable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
