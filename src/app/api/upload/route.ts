import { NextRequest, NextResponse } from 'next/server'
import { uploadToS3 } from '@/lib/s3'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

// Max file size: 5 MB
const MAX_FILE_SIZE = 5 * 1024 * 1024

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]

/**
 * POST /api/upload
 *
 * Accepts a multipart/form-data request with a single `file` field.
 * Uploads the file to S3 and returns { url }.
 *
 * Optional form field:
 *   - folder: string  (e.g. "products") — used as the S3 key prefix.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file')
    const folder = (formData.get('folder') as string | null) ?? 'products'

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const mimeType = file.type
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${mimeType}. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    if (buffer.byteLength > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 5 MB.' },
        { status: 400 }
      )
    }

    // Build a unique S3 key: e.g. products/a1b2c3d4.jpg
    const ext = mimeType.split('/')[1].replace('jpeg', 'jpg')
    const key = `${folder}/${randomUUID()}.${ext}`

    try {
      // Log file size and target key for debugging
      console.log(`[upload] uploading to S3 — key=${key} size=${buffer.byteLength} mime=${mimeType}`)
      const url = await uploadToS3(key, buffer, mimeType)
      console.log(`[upload] succeeded — url=${url}`)
      return NextResponse.json({ url, key }, { status: 200 })
    } catch (s3Err: any) {
      // Log full error to aid debugging (stack, message, code)
      console.error('[/api/upload] S3 upload failed', {
        key,
        size: buffer.byteLength,
        mimeType,
        errorMessage: s3Err?.message ?? s3Err,
        stack: s3Err?.stack,
        error: s3Err,
      })
      return NextResponse.json({ error: s3Err?.message || 'Failed to upload to S3' }, { status: 500 })
    }
  } catch (err: any) {
    console.error('[/api/upload] Error uploading to S3:', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to upload file' },
      { status: 500 }
    )
  }
}
