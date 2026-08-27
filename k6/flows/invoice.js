// Invoice creation — the heaviest single write in the app.
//
// POST /api/invoices accepts up to 500 line items and, in one transaction,
// inserts the invoice, every line, and a stock movement per line. Payload
// size is the variable that matters, so PERF_INVOICE_LINES drives it and the
// endpoint tag stays constant so p95 is comparable across runs.
//
// NOT covered here, on purpose:
//   POST /api/invoices/parse-pdf  — every call ships a PDF to a metered
//     Gemini endpoint (RULES.expensive: 20/hour). Load-testing it spends real
//     money and proves nothing about this app's own capacity.
//   POST /api/upload/presign      — signs against real Cloudinary, same
//     reasoning.
// If you need those covered, stub the provider first. See k6/README.md.

import { get, post, json } from '../lib/session.js'
import { flowDuration, flowSuccess, rowsCreated } from '../lib/metrics.js'
import { invoiceNumber, supplierName, recentDate, invoiceItems, randInt } from '../lib/data.js'
import { num } from '../lib/config.js'

const LINES_MIN = num('PERF_INVOICE_LINES_MIN', 3)
const LINES_MAX = num('PERF_INVOICE_LINES_MAX', 12)

export function invoiceFlow(state) {
  const started = Date.now()

  const preview = get('/api/invoices/next-number', { endpoint: 'next_invoice_number', flow: 'invoice' })

  const items = invoiceItems(randInt(LINES_MIN, LINES_MAX), state.products)
  const total = items.reduce((sum, i) => sum + i.total_cost, 0)

  const createRes = post(
    '/api/invoices',
    {
      invoice_number: invoiceNumber(),
      supplier_name: supplierName(),
      received_date: recentDate(30),
      total_amount: Math.round(total * 100) / 100,
      items,
    },
    { endpoint: 'invoice_create', flow: 'invoice' },
  )

  const created = json(createRes)
  let read = true

  if (created && created.invoice) {
    rowsCreated.add(1, { table: 'purchase_invoice' })
    rowsCreated.add(items.length, { table: 'purchase_invoice_item' })
    const res = get(`/api/invoices/${created.invoice.invoice_id}`, {
      endpoint: 'invoice_detail',
      flow: 'invoice',
      allow404: true,
    })
    read = res.status < 500
  }

  const success = preview.status === 200 && createRes.status === 201 && read
  flowDuration.add(Date.now() - started, { flow: 'invoice' })
  flowSuccess.add(success, { flow: 'invoice' })
  return success
}
