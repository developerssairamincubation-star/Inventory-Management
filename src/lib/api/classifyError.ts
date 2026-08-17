// Maps known error shapes (Postgres constraint violations, connection
// failures) to a specific, safe, user-facing message. Unknown errors get a
// generic fallback. Callers (fromError) are responsible for logging the
// full technical detail separately — nothing from here should ever be raw
// driver/SDK text.

const POSTGRES_MESSAGES: Record<string, string> = {
  '23505': 'That already exists. Please use a different value.',
  '23503': "This can't be completed because it's linked to other records.",
  '23502': 'A required field is missing.',
  '23514': "That value isn't valid.",
}

const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET'])

export const GENERIC_ERROR_MESSAGE = 'Something went wrong on our end. Please try again in a moment.'
const CONNECTION_ERROR_MESSAGE = "We're having trouble reaching the database right now. Please try again shortly."

export function classifyError(error: unknown): string {
  const code = (error as { code?: unknown } | null | undefined)?.code
  if (typeof code === 'string') {
    if (code in POSTGRES_MESSAGES) return POSTGRES_MESSAGES[code]
    if (CONNECTION_CODES.has(code)) return CONNECTION_ERROR_MESSAGE
  }
  return GENERIC_ERROR_MESSAGE
}
