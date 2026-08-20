import { NextResponse } from 'next/server'
import { isApiError } from '@/lib/api/errors'
import { classifyError } from '@/lib/api/classifyError'
import { reportError } from '@/lib/api/reportError'
import { logger } from '@/lib/logger'

export type ApiFailure = {
  success: false
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json<T>(data, { status })
}

export function created<T>(data: T) {
  return ok(data, 201)
}

export function noContent() {
  return new NextResponse(null, { status: 204 })
}

export function fail(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json<ApiFailure>(
    {
      success: false,
      error: { code, message, ...(details !== undefined ? { details } : {}) },
    },
    { status }
  )
}

/** Context threaded from the route so a log line, a Sentry event, and the client's failed response share one id. */
export type ErrorContext = {
  requestId?: string | null
  userId?: string | null
  route?: string | null
}

export function fromError(error: unknown, context: ErrorContext = {}) {
  if (isApiError(error)) {
    // Expected, deliberate failures (400s, 404s, auth rejections) are normal
    // control flow — logged at debug, never reported as defects.
    logger.debug('Request rejected', { ...context, code: error.code, status: error.status })
    return fail(error.status, error.code, error.message, error.details)
  }

  // Unexpected errors (DB driver failures, third-party SDK errors) never
  // forward their raw message to the client — only a safe, classified one.
  // Full detail goes to the structured log and to Sentry, correlated by
  // requestId.
  logger.error('Unhandled route error', context, error)
  reportError(error, context)
  return fail(500, 'INTERNAL_SERVER_ERROR', classifyError(error))
}

export function badRequest(message: string, details?: unknown) {
  return fail(400, 'BAD_REQUEST', message, details)
}

export function notFound(message: string, details?: unknown) {
  return fail(404, 'NOT_FOUND', message, details)
}

export function forbidden(message = 'You do not have permission to do that') {
  return fail(403, 'FORBIDDEN', message)
}

export function conflict(message: string, details?: unknown) {
  return fail(409, 'CONFLICT', message, details)
}

/**
 * For a dependency we could not reach. Distinct from a 500 so the client can
 * retry rather than treating it as a defect — and so a database outage never
 * again surfaces as an empty list or a forced sign-out.
 */
export function serviceUnavailable(message = "We're having trouble reaching the database right now. Please try again shortly.") {
  return NextResponse.json<ApiFailure>(
    { success: false, error: { code: 'SERVICE_UNAVAILABLE', message } },
    { status: 503, headers: { 'Retry-After': '5' } }
  )
}
