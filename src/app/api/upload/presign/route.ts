import { NextRequest, NextResponse } from 'next/server'
import { createSignedUpload } from '@/lib/cloudinary'

export const dynamic = 'force-dynamic'

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']

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
  } catch (err) {
    console.error('[/api/upload/presign] Error generating signed upload:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to sign upload' }, { status: 500 })
  }
}
