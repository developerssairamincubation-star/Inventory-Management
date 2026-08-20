import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createSignedUpload } from '@/lib/cloudinary'
import { requireUser } from '@/lib/authz'
import { fromError, ok } from '@/lib/api/response'
import { parseBody } from '@/lib/validation'
import { requestIdFrom } from '@/lib/logger'

export const dynamic = 'force-dynamic'

// application/pdf: invoice source documents (src/components/UploadInvoiceModal.tsx)
// — Cloudinary's image/upload endpoint accepts PDFs directly, no separate
// resource type needed (see src/lib/cloudinary.ts's createSignedUpload).
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'application/pdf'] as const

// The folder used to be free text taken straight from the request body and
// interpolated into `${rootFolder}/${folderSuffix}`, so a caller could sign an
// upload into any path in the Cloudinary account — including `../production/…`
// to cross the very boundary CLOUDINARY_UPLOAD_FOLDER exists to maintain.
// An allowlist is the only thing this endpoint ever actually needed.
const ALLOWED_FOLDERS = ['products', 'invoices'] as const

const presignSchema = z.object({
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  folder: z.enum(ALLOWED_FOLDERS).default('products'),
})

/**
 * POST /api/upload/presign
 *
 * Returns a short-lived signed upload so the browser can POST directly to
 * Cloudinary — this server never buffers the file bytes.
 *
 * This route previously never called into the auth layer at all: it was the
 * one endpoint in the app relying solely on the Edge middleware, which checks
 * a JWT signature but cannot check is_active, cannot resolve the current role,
 * and does not apply the CSRF check. A user deactivated moments earlier could
 * still mint signed uploads until their access token expired.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response

  try {
    const { mimeType, folder } = await parseBody(req, presignSchema)
    return ok(createSignedUpload(folder, mimeType))
  } catch (error) {
    return fromError(error, {
      requestId: requestIdFrom(req),
      userId: auth.user.user_id,
      route: 'POST /api/upload/presign',
    })
  }
}
