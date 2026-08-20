// Request-body validation.
//
// Routes used to hand-parse `body.someField` with ad-hoc checks that ranged
// from thorough (the transfer route) to entirely absent (lending quantities,
// order status, admin passwords). That inconsistency is the direct cause of
// the stock-inflation bugs: an unchecked negative `quantity` flowed from the
// request body into arithmetic on the stocks table, where
// `Math.max(0, stock - quantity)` turned a subtraction into an addition.
//
// Every mutating route now parses its body through a schema declared here.

import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'

// ── Primitives ───────────────────────────────────────────────────────────

/**
 * The type that had to exist. Inventory counts are whole, positive, and
 * bounded — an unbounded integer still lets someone set stock to 2^31 and
 * overflow the INT column.
 */
export const positiveQuantity = z.number().int().positive().max(1_000_000)

/** Same, but zero is a legitimate value (setting stock to empty). */
export const nonNegativeQuantity = z.number().int().min(0).max(1_000_000)

/** Money. numeric(12,2) in Postgres, so two decimal places and non-negative. */
export const money = z.number().nonnegative().max(99_999_999).multipleOf(0.01)

export const uuid = z.uuid()

/** Optional free-text, trimmed, length-capped to match the column. */
export const shortText = (max: number) =>
  z.string().trim().min(1).max(max)

export const optionalShortText = (max: number) =>
  z.string().trim().max(max).transform((v) => v || null).nullable().optional()

/**
 * A calendar date the app is willing to record. Rejects unparseable strings
 * (which previously became `Invalid Date` and failed at insert time as an
 * opaque 500) and rejects future dates, which let lending records be
 * backdated or post-dated out of every reporting window.
 */
export const pastOrPresentDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Not a valid date' })
  .refine((v) => Date.parse(v) <= Date.now() + 60_000, { message: 'Date cannot be in the future' })

export const isoDateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')

// ── Domain enums ─────────────────────────────────────────────────────────

export const lendingItemType = z.enum(['RETURNABLE', 'CONSUMABLE'])

/**
 * Statuses a client is permitted to name directly. The full
 * lending_order_status enum has ten values, but the terminal and derived
 * ones (RETURNED, LOST, PARTIALLY_*) are computed by the server from the
 * line items — letting a client set them directly desynced the order from
 * its items and from stock.
 */
export const clientSettableOrderStatus = z.enum(['PENDING', 'CONSUMABLE'])

export const userRole = z.enum(['super_admin', 'user'])

// ── Passwords ────────────────────────────────────────────────────────────

// Not exhaustive, and not meant to be — it catches the handful of passwords
// that actually show up first in a credential-stuffing list. The length
// floor does the real work.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', '123456', '12345678', '123456789',
  '1234567890', 'qwerty', 'qwerty123', 'admin', 'admin123', 'administrator', 'letmein',
  'welcome', 'welcome1', 'welcome123', 'iloveyou', 'monkey', 'dragon', 'football',
  'baseball', 'sunshine', 'princess', 'changeme', 'changeme123', 'inventory',
  'inventory123', 'abc123', 'abcd1234', 'p@ssw0rd', 'trustno1',
])

export const password = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(200, 'Password must be at most 200 characters')
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), {
    message: 'That password is too common. Please choose a less predictable one.',
  })
  .refine((v) => new Set(v).size >= 5, {
    message: 'Password must use at least 5 different characters',
  })

export const email = z.email().max(255).transform((v) => v.trim().toLowerCase())

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Reads and validates a JSON body, throwing an ApiError the shared
 * `fromError` handler already knows how to render. `details` carries the
 * per-field messages so a form can show them inline.
 */
export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Invalid JSON request body')
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(body)',
      message: issue.message,
    }))
    throw new ApiError(400, 'VALIDATION_ERROR', details[0]?.message ?? 'Invalid request body', details)
  }

  return result.data
}

/** Route params arrive as strings; a malformed id should be a 400, not a DB error. */
export function parseUuidParam(value: string, field = 'id'): string {
  const result = uuid.safeParse(value)
  if (!result.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} is not a valid identifier`)
  }
  return result.data
}

/**
 * Escapes LIKE/ILIKE metacharacters. Drizzle parameterises correctly so this
 * was never SQL injection, but an unescaped `%` let a caller force a
 * full-table wildcard scan on an unindexed column.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}
