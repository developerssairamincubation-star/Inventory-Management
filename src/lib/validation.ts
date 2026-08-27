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
export const positiveQuantity = z
  .number({ error: 'must be a number' })
  .int('must be a whole number')
  .positive('must be at least 1')
  .max(1_000_000, 'is too large')

/** Same, but zero is a legitimate value (setting stock to empty). */
export const nonNegativeQuantity = z
  .number({ error: 'must be a number' })
  .int('must be a whole number')
  .min(0, 'cannot be negative')
  .max(1_000_000, 'is too large')

/**
 * Money. numeric(12,2) in Postgres, so two decimal places and non-negative.
 *
 * The messages here are written to be read by whoever is filling in the form,
 * not by whoever wrote the schema. Zod's default for the last rule is
 * "Invalid number: must be a multiple of 0.01", which is accurate and tells a
 * user nothing about what to do. This is the rule real invoices trip most
 * often: a supplier PDF that prints a unit price to three decimals, or a
 * parsed value like 33.333, is rejected here.
 */
export const money = z
  .number({ error: 'must be a number' })
  .nonnegative('cannot be negative')
  .max(99_999_999, 'is too large')
  .multipleOf(0.01, 'can have at most 2 decimal places (for example 33.33, not 33.333)')

// Message is written to complete the sentence describeIssue() builds, e.g.
// "Line 3: category is not a valid selection" — Zod's default ("Invalid UUID")
// reads as gibberish to anyone who isn't a developer.
export const uuid = z.uuid('is not a valid selection')

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
// that actually show up first in a credential-stuffing list.
//
// These carry more weight than they used to. The length floor was 12, which
// was doing most of the work; at 6 it is no longer a serious barrier on its
// own, so the blocklist and the distinct-character rule are what stop the
// most obvious choices.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', '123456', '12345678', '123456789',
  '1234567890', 'qwerty', 'qwerty123', 'admin', 'admin123', 'administrator', 'letmein',
  'welcome', 'welcome1', 'welcome123', 'iloveyou', 'monkey', 'dragon', 'football',
  'baseball', 'sunshine', 'princess', 'changeme', 'changeme123', 'inventory',
  'inventory123', 'abc123', 'abcd1234', 'p@ssw0rd', 'trustno1',
])

/**
 * Messages are written as sentence fragments, not full sentences:
 * describeIssue() in parseBody prepends the field label, so a message that
 * began with "Password" rendered as "Password Password must be at least 6
 * characters".
 *
 * Minimum length is 6, matching what the admin "add user" form has always
 * told people ("Min. 6 characters", minLength={6}). The schema said 12, so
 * the form was rejecting passwords that satisfied its own hint — the two
 * agree now.
 *
 * 6 is a deliberate product decision, not a security recommendation: it is
 * short enough to be brute-forced offline if the hashes ever leak. What
 * stands behind it here is bcrypt at cost 12, the login rate limits in
 * src/lib/rateLimit.ts (8 attempts per IP and 12 per account per 15
 * minutes), and the two content rules below. Raise this before the app
 * holds anything that would hurt to lose.
 */
export const password = z
  .string()
  .min(6, 'must be at least 6 characters')
  .max(200, 'must be at most 200 characters')
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), {
    message: 'is too common — please choose a less predictable one',
  })
  .refine((v) => new Set(v).size >= 5, {
    message: 'must use at least 5 different characters',
  })

export const email = z.email().max(255).transform((v) => v.trim().toLowerCase())

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Reads and validates a JSON body, throwing an ApiError the shared
 * `fromError` handler already knows how to render. `details` carries the
 * per-field messages so a form can show them inline.
 */
/**
 * Turns a Zod issue path into something readable.
 *
 *   ["items", 3, "unit_cost"]  ->  "Line 4: unit cost can have at most 2 decimal places"
 *   ["supplier_name"]          ->  "Supplier name is required"
 *
 * Array indices become 1-based line numbers because that is how the row is
 * labelled on screen; a user counting rows does not start at zero.
 */
const FIELD_LABELS: Record<string, string> = {
  unit_cost: 'unit cost',
  total_cost: 'total cost',
  product_name: 'product name',
  supplier_name: 'supplier name',
  invoice_number: 'invoice number',
  received_date: 'received date',
  total_amount: 'total amount',
  student_id_code: 'student ID',
  lending_items: 'items',
  due_date: 'due date',
  category_id: 'category',
  domain_id: 'COE domain',
  image_url: 'image',
  quantity: 'quantity',
  location: 'location',
  description: 'description',
  email: 'email',
  name: 'name',
}

export function describeIssue(path: ReadonlyArray<PropertyKey>, message: string): string {
  const segments = path.map((p) => (typeof p === 'number' ? p : String(p)))
  const lineIndex = segments.findIndex((p) => typeof p === 'number')

  const fieldKey = String(segments[segments.length - 1] ?? '')
  const label = FIELD_LABELS[fieldKey] ?? fieldKey.replace(/_/g, ' ')

  const prefix = lineIndex >= 0 ? `Line ${(segments[lineIndex] as number) + 1}: ` : ''
  if (!label) return `${prefix}${message}`

  const sentence = `${prefix}${label} ${message}`
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

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
      // A sentence the person filling in the form can act on, rather than a
      // schema path. "items.3.unit_cost" + "must be a multiple of 0.01" told
      // a user neither which row was wrong nor what to change.
      detail: describeIssue(issue.path, issue.message),
    }))
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      details[0]?.detail ?? details[0]?.message ?? 'Invalid request body',
      details,
    )
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
