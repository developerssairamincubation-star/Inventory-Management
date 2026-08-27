#!/usr/bin/env node
/**
 * Deletes every uploaded asset for ONE environment from Cloudinary.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Read this before running it.
 *
 * This project uses a SINGLE Cloudinary account for local dev and every
 * hosted environment. They are separated only by the root folder named in
 * CLOUDINARY_UPLOAD_FOLDER ("dev", "dit", "production", …). There is no
 * account-level boundary — a careless prefix here deletes production's
 * product images, and Cloudinary deletions are not recoverable.
 *
 * So this script:
 *   - refuses to run unless CLOUDINARY_UPLOAD_FOLDER is set explicitly
 *     (src/lib/cloudinary.ts silently falls back to "inventory"; that
 *     fallback is fine for uploading and dangerous for deleting)
 *   - refuses production-looking folder names unless --i-know
 *   - is DRY RUN by default and only lists what it would remove
 *   - requires --yes to delete anything at all
 *
 * Usage:
 *   node scripts/flush-object-storage.mjs              # dry run — lists, deletes nothing
 *   node scripts/flush-object-storage.mjs --yes        # actually delete
 *   node scripts/flush-object-storage.mjs --yes --i-know   # override the prod-name guard
 *
 * Pair it with a database flush: assets and the rows pointing at them
 * (product_image.image_url, invoice_documents.file_url) must go together, or
 * you are left with dangling URLs or orphaned files nobody can reach.
 */

import { config } from 'dotenv'
import { v2 as cloudinary } from 'cloudinary'

config({ path: '.env' })

const args = new Set(process.argv.slice(2))
const APPLY = args.has('--yes')
const OVERRIDE = args.has('--i-know')

const cloudName = process.env.CLOUDINARY_CLOUD_NAME
const apiKey = process.env.CLOUDINARY_API_KEY
const apiSecret = process.env.CLOUDINARY_API_SECRET
const root = process.env.CLOUDINARY_UPLOAD_FOLDER

function die(msg) {
  console.error(`\n  ✗ ${msg}\n`)
  process.exit(1)
}

if (!cloudName || !apiKey || !apiSecret) {
  die('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in .env.')
}

// Deliberately no `|| "inventory"` fallback here, unlike src/lib/cloudinary.ts.
// An unset value there means "upload somewhere sensible"; an unset value here
// would mean "delete a folder you did not name".
if (!root) {
  die('CLOUDINARY_UPLOAD_FOLDER is not set. Refusing to guess which environment to flush.')
}

const looksProd = /prod|live|main|release/i.test(root)
if (looksProd && !OVERRIDE) {
  die(`CLOUDINARY_UPLOAD_FOLDER="${root}" looks like a production environment.\n` +
      `    If you genuinely mean to delete it, re-run with --i-know.`)
}

cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true })

// Mirrors UPLOAD_FOLDERS in src/lib/cloudinary.ts. Everything is uploaded
// through the /image/upload endpoint, so resource_type is "image" even for
// the invoice PDFs.
const SUBFOLDERS = ['products', 'invoices']
const RESOURCE_TYPE = 'image'

async function listAll(prefix) {
  const found = []
  let cursor
  do {
    const res = await cloudinary.api.resources({
      type: 'upload',
      resource_type: RESOURCE_TYPE,
      prefix,
      max_results: 500,
      next_cursor: cursor,
    })
    found.push(...res.resources.map((r) => ({ id: r.public_id, bytes: r.bytes, at: r.created_at })))
    cursor = res.next_cursor
  } while (cursor)
  return found
}

const human = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`)

console.log(`\n  cloud     ${cloudName}`)
console.log(`  folder    ${root}/`)
console.log(`  mode      ${APPLY ? 'DELETE' : 'dry run (nothing will be removed)'}\n`)

let grandTotal = 0
let grandBytes = 0

for (const sub of SUBFOLDERS) {
  const prefix = `${root}/${sub}`
  const items = await listAll(prefix)
  const bytes = items.reduce((s, i) => s + (i.bytes || 0), 0)
  grandTotal += items.length
  grandBytes += bytes

  console.log(`  ${prefix}/  —  ${items.length} asset(s), ${human(bytes)}`)
  for (const i of items.slice(0, 5)) console.log(`      ${i.id}`)
  if (items.length > 5) console.log(`      … and ${items.length - 5} more`)

  if (APPLY && items.length) {
    // delete_resources_by_prefix caps at 1000 per call, so loop until the
    // prefix reports empty rather than assuming one pass is enough.
    let remaining = items.length
    while (remaining > 0) {
      await cloudinary.api.delete_resources_by_prefix(prefix, { resource_type: RESOURCE_TYPE })
      remaining = (await listAll(prefix)).length
    }
    // The now-empty folder itself lingers in the media library otherwise.
    await cloudinary.api.delete_folder(prefix).catch(() => {})
    console.log(`      ✓ deleted`)
  }
  console.log('')
}

if (!APPLY) {
  console.log(`  ${grandTotal} asset(s), ${human(grandBytes)} would be deleted.`)
  console.log(`  Re-run with --yes to actually delete them.\n`)
} else {
  console.log(`  Done. ${grandTotal} asset(s) removed from ${root}/.\n`)
  console.log(`  Rows in product_image.image_url and invoice_documents.file_url now`)
  console.log(`  point at deleted assets — flush the database too (README §6).\n`)
}
