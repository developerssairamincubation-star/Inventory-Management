import * as Sentry from '@sentry/nextjs'
import { isApiError } from '@/lib/api/errors'

/**
 * Sends an unexpected server-side error to Sentry.
 *
 * Every API route wraps its handler in try/catch and returns a JSON 500
 * instead of letting the error escape. That's right for clients, but it also
 * means Sentry's `onRequestError` hook (which only fires for errors that
 * *escape* a handler) never sees any of them — which is why the project
 * reported zero events despite being fully configured. Routes report through
 * `fromError`, which calls this.
 *
 * Expected, deliberate failures (`ApiError` — 400s, 404s, auth rejections)
 * are skipped: they're normal control flow, not defects worth alerting on.
 *
 * `requestId` is promoted to a Sentry tag rather than buried in `extra` so an
 * issue can be searched by it and matched against the structured log line for
 * the same request.
 */
export function reportError(error: unknown, context?: Record<string, unknown>) {
  if (isApiError(error)) return

  const { requestId, userId, ...extra } = (context ?? {}) as Record<string, unknown>

  Sentry.captureException(error, {
    tags: {
      ...(typeof requestId === 'string' ? { request_id: requestId } : {}),
    },
    ...(typeof userId === 'string' ? { user: { id: userId } } : {}),
    ...(Object.keys(extra).length ? { extra } : {}),
  })
}
