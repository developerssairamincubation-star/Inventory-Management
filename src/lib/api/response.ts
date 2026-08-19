import { NextResponse } from 'next/server'
import { isApiError } from '@/lib/api/errors'
import { classifyError } from '@/lib/api/classifyError'
import { reportError } from '@/lib/api/reportError'

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

export function fromError(error: unknown) {
  if (isApiError(error)) {
    return fail(error.status, error.code, error.message, error.details)
  }

  // Unexpected errors (DB driver failures, third-party SDK errors, etc.)
  // never forward their raw message to the client — only a safe, classified
  // one. Full detail (stack trace, driver error code) goes to the server
  // log, which is where a developer would actually look for it.
  console.error('[fromError] Unexpected error:', error)
  reportError(error, { source: 'fromError' })
  return fail(500, 'INTERNAL_SERVER_ERROR', classifyError(error))
}

export function badRequest(message: string, details?: unknown) {
  return fail(400, 'BAD_REQUEST', message, details)
}

export function notFound(message: string, details?: unknown) {
  return fail(404, 'NOT_FOUND', message, details)
}
