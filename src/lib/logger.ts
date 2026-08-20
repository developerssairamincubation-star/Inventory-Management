// Structured JSON logging with request correlation.
//
// Before this, every log line in the app was a bare `console.error` with a
// hand-written prefix — no level, no request id, no user id, and no way to
// tie a log line to the Sentry event for the same failure. When an operator
// said "it broke around 3pm" there was no way to find their request.
//
// Every log line now carries a `requestId` that middleware.ts generates and
// forwards on the `x-request-id` header, and that the same request's Sentry
// events are tagged with (see reportError). One id ties the browser's failed
// response, the server log, and the Sentry issue together.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export const REQUEST_ID_HEADER = 'x-request-id'

export type LogContext = {
  requestId?: string | null
  userId?: string | null
  route?: string | null
  [key: string]: unknown
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function minLevel(): number {
  const configured = (process.env.LOG_LEVEL || '').toLowerCase() as LogLevel
  if (configured in LEVEL_ORDER) return LEVEL_ORDER[configured]
  return process.env.NODE_ENV === 'production' ? LEVEL_ORDER.info : LEVEL_ORDER.debug
}

// Error instances don't survive JSON.stringify (message and stack are
// non-enumerable), so they're unwrapped explicitly. Postgres driver errors
// carry a `code` that's genuinely useful in a log — keep it.
function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(typeof (error as unknown as { code?: unknown }).code === 'string'
        ? { code: (error as unknown as { code: string }).code }
        : {}),
    }
  }
  return { message: String(error) }
}

function emit(level: LogLevel, message: string, context: LogContext = {}, error?: unknown) {
  if (LEVEL_ORDER[level] < minLevel()) return

  const entry: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    message,
    ...context,
  }
  if (error !== undefined) entry.error = serializeError(error)

  // One JSON object per line: greppable by hand, and parsed as structured
  // fields by any log aggregator without a custom pattern.
  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit('debug', message, context),
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext, error?: unknown) => emit('warn', message, context, error),
  error: (message: string, context?: LogContext, error?: unknown) => emit('error', message, context, error),
}

/**
 * The correlation id for this request.
 *
 * Prefers an id supplied upstream — a load balancer, or a client retrying a
 * failed call — so a single id spans the whole hop. Falls back to generating
 * one, which is what actually happens today: the Edge middleware sets this
 * header on the forwarded request, but Next 16 does not propagate middleware
 * request headers to route handlers (verified against a running server), so
 * routes would otherwise log `requestId: null` for every request.
 *
 * Generating here still achieves the point of the id: one route invocation
 * produces one id, shared by its log lines and the Sentry event for the same
 * failure, so an issue can be searched by it and matched to the server log.
 *
 * Memoised against the request object, because routes call this more than
 * once — typically to stamp an audit entry and again in the catch block. A
 * fresh uuid per call would defeat the whole purpose.
 */
const generatedIds = new WeakMap<object, string>()

export function requestIdFrom(req: { headers: { get(name: string): string | null } }): string {
  const forwarded = req.headers.get(REQUEST_ID_HEADER)
  if (forwarded) return forwarded

  const existing = generatedIds.get(req)
  if (existing) return existing

  const generated = crypto.randomUUID()
  generatedIds.set(req, generated)
  return generated
}
