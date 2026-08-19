import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'

export const dynamic = 'force-dynamic'

// Verification endpoint for the Sentry integration — deliberately throws so a
// real event lands in the dashboard, which is the only way to confirm the DSN,
// network path and build-time instrumentation all line up.
//
// Disabled unless SENTRY_TEST_ROUTE=1 is set, so it is inert unless somebody
// explicitly turns it on. Note the SDK only sends when NODE_ENV=production, so
// under `next dev` this returns { sent: true } while the event is dropped
// locally by design — verify against a deployment, not a dev server.
export async function GET() {
  if (process.env.SENTRY_TEST_ROUTE !== '1') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const error = new Error('Sentry verification event from /api/sentry-check')
  Sentry.captureException(error)

  // Nothing is reported until the event is actually flushed — serverless and
  // standalone runtimes can tear the process down before the background send
  // completes, which silently drops the event.
  await Sentry.flush(5000)

  return NextResponse.json({ sent: true, message: error.message })
}
