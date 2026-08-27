// Deterministic-ish random data for the write flows.
//
// Two rules everything here follows:
//
//  1. Every generated value is namespaced with RUN_ID so k6/seed/cleanup.sql
//     can find and delete exactly what a run created, and nothing else. The
//     local Postgres in this project is a persistent dev database with real
//     accumulated data — load-test rows must be removable without touching it.
//
//  2. Identifiers stay inside a bounded pool rather than growing without
//     limit. Students in particular are get-or-create in POST /api/lending,
//     so reusing a pool of codes exercises the realistic path (returning
//     borrower) instead of inserting a new student on every single iteration.

import { RUN_ID } from './config.js'

export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function pick(array) {
  return array[randInt(0, array.length - 1)]
}

export function thinkTime(min, max) {
  return min + Math.random() * (max - min)
}

/** Weighted pick over `{ name: weight }`. Weights need not sum to 100. */
export function weightedPick(weights) {
  const entries = Object.keys(weights).map((k) => [k, weights[k]])
  const total = entries.reduce((sum, e) => sum + e[1], 0)
  let roll = Math.random() * total
  for (const [name, weight] of entries) {
    roll -= weight
    if (roll <= 0) return name
  }
  return entries[entries.length - 1][0]
}

// ── Students ─────────────────────────────────────────────────────────────

const COLLEGE_CODES = ['sit', 'sec'] // src/lib/studentIdCode.ts COLLEGE_CODES

/**
 * A student ID code the app will actually decode:
 *   [3-letter college][2-digit join year][2-letter dept][3-digit serial]
 *
 * `deptCode` MUST be a code that exists in the departments table — POST
 * /api/lending returns 422 UNKNOWN_DEPARTMENT otherwise, which would make the
 * lending flow measure a validation rejection instead of a real transaction.
 * setup() reads the real codes from GET /api/departments.
 *
 * Serial is drawn from a bounded pool so a long soak reuses borrowers
 * instead of creating one student row per iteration.
 */
export function studentIdCode(deptCode, poolSize = 200) {
  const college = pick(COLLEGE_CODES)
  const year = String(randInt(21, 25))
  const serial = String(randInt(0, poolSize - 1)).padStart(3, '0')
  return `${college}${year}${String(deptCode).toLowerCase()}${serial}`
}

export function studentName(code) {
  return `K6 Student ${code.toUpperCase()}`
}

// ── Products / invoices ──────────────────────────────────────────────────

const NOUNS = ['Multimeter', 'Oscilloscope Probe', 'Breadboard', 'Servo Motor', 'Jumper Wire Set',
  'Soldering Iron', 'LED Strip', 'Raspberry Pi', 'Sensor Kit', 'Battery Pack']

/** Prefixed so cleanup can target it, and so it is obvious in the UI. */
export function productName() {
  return `k6-${RUN_ID}-${pick(NOUNS)}-${randInt(1000, 9999)}`
}

export function supplierName() {
  return `k6-${RUN_ID}-Supplier-${randInt(1, 20)}`
}

/** Unique per call — invoice_number has no uniqueness constraint but reuse muddies reporting. */
export function invoiceNumber() {
  return `K6-${RUN_ID}-${randInt(100000, 999999)}`
}

export function money(min, max) {
  return Math.round((min + Math.random() * (max - min)) * 100) / 100
}

/** yyyy-mm-dd for the last `withinDays` days — routes reject future dates. */
export function recentDate(withinDays = 30) {
  const d = new Date(Date.now() - randInt(0, withinDays) * 86400000)
  return d.toISOString().slice(0, 10)
}

/** yyyy-mm-dd `days` in the future, for lending due dates. */
export function futureDate(days = 14) {
  const d = new Date(Date.now() + days * 86400000)
  return d.toISOString().slice(0, 10)
}

export function invoiceItems(count, productPool) {
  const items = []
  for (let i = 0; i < count; i++) {
    const quantity = randInt(1, 25)
    const unit_cost = money(50, 5000)
    const linked = productPool && productPool.length && Math.random() < 0.6
      ? pick(productPool)
      : null
    items.push({
      product_id: linked ? linked.product_id : null,
      product_name: linked ? linked.product_name : productName(),
      quantity,
      unit_cost,
      total_cost: Math.round(quantity * unit_cost * 100) / 100,
      location: pick(['Rack A', 'Rack B', 'Store Room', 'Lab 1']),
    })
  }
  return items
}
