import { NextRequest, NextResponse } from 'next/server'
import { createSignedUpload } from '@/lib/cloudinary'
import { classifyError } from '@/lib/api/classifyError'

export const dynamic = 'force-dynamic'

// application/pdf: invoice source documents (src/components/UploadInvoiceModal.tsx)
// — Cloudinary's image/upload endpoint accepts PDFs directly, no separate
// resource type needed (see src/lib/cloudinary.ts's createSignedUpload).
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'application/pdf']

/**
 * POST /api/upload/presign
 *
 * Returns a short-lived signed upload so the browser can POST directly to
 * Cloudinary — this server never buffers the file bytes. Body:
 * { mimeType: string, folder?: string }
 * Response: { uploadUrl, apiKey, timestamp, signature, folder }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const mimeType = body?.mimeType as string | undefined
    const folder = (body?.folder as string | undefined) ?? 'products'

    if (!mimeType || !ALLOWED_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${mimeType}. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    return NextResponse.json(createSignedUpload(folder))
  } catch (error) {
    console.error('[/api/upload/presign] Error generating signed upload:', error)
    return NextResponse.json({ error: classifyError(error) }, { status: 500 })
  }
}
