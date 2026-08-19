import * as Sentry from '@sentry/nextjs'
import { isApiError } from '@/lib/api/errors'

/**
 * Sends an unexpected server-side error to Sentry.
 *
 * Every API route in this app wraps its handler in try/catch and returns a
 * JSON 500 instead of letting the error escape. That's the right behaviour
 * for clients, but it also means Sentry's `onRequestError` hook (which only
 * fires for errors that *escape* a handler) never sees any of them — which
 * is why the project reported zero events despite being fully configured.
 * Routes call this explicitly so caught errors still get reported.
 *
 * Expected, deliberate failures (`ApiError` — 400s, 404s, auth rejections)
 * are skipped: they're normal control flow, not defects worth alerting on.
 */
export function reportError(error: unknown, context?: Record<string, unknown>) {
  if (isApiError(error)) return

  Sentry.captureException(error, context ? { extra: context } : undefined)
}
