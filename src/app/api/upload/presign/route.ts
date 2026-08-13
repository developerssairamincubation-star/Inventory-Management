import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3Client, getPublicUrl } from '@/lib/s3'

export const dynamic = 'force-dynamic'

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
const PRESIGN_EXPIRY_SECONDS = 60

/**
 * POST /api/upload/presign
 *
 * Returns a short-lived presigned PUT URL so the browser can upload
 * directly to storage — the Next.js server never buffers the file bytes.
 * Body: { filename?: string, mimeType: string, folder?: string }
 * Response: { uploadUrl, url, key }
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

    const ext = mimeType.split('/')[1].replace('jpeg', 'jpg')
    const key = `${folder}/${randomUUID()}.${ext}`

    const uploadUrl = await getSignedUrl(
      s3Client,
      new PutObjectCommand({ Bucket: process.env.AWS_S3_BUCKET_NAME, Key: key, ContentType: mimeType }),
      { expiresIn: PRESIGN_EXPIRY_SECONDS }
    )

    return NextResponse.json({ uploadUrl, url: getPublicUrl(key), key })
  } catch (err) {
    console.error('[/api/upload/presign] Error generating presigned URL:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to presign upload' }, { status: 500 })
  }
}
