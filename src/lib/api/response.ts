import { NextResponse } from 'next/server'
import { isApiError } from '@/lib/api/errors'

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

  const message = error instanceof Error ? error.message : 'Internal Server Error'
  return fail(500, 'INTERNAL_SERVER_ERROR', message)
}

export function badRequest(message: string, details?: unknown) {
  return fail(400, 'BAD_REQUEST', message, details)
}

export function notFound(message: string, details?: unknown) {
  return fail(404, 'NOT_FOUND', message, details)
}
