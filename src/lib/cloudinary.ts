import { v2 as cloudinary } from 'cloudinary'
import { ApiError } from '@/lib/api/errors'

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
})

// Root folder all uploads live under — lets one Cloudinary account serve
// both local dev and every hosted environment without their images mixing
// (e.g. "dev" locally, "production" in prod). Falls back to "inventory" so
// nothing throws if it's left unset.
const rootFolder = process.env.CLOUDINARY_UPLOAD_FOLDER || 'inventory'

/**
 * Folders callers may sign an upload into. The route validates against this
 * too; keeping the check here as well means a future caller can't reintroduce
 * the free-text folder that let a signed upload be aimed at any path in the
 * account — including another environment's.
 */
export const UPLOAD_FOLDERS = ['products', 'invoices'] as const
export type UploadFolder = (typeof UPLOAD_FOLDERS)[number]

const MIME_TO_FORMATS: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'image/avif': ['avif'],
  'application/pdf': ['pdf'],
}

export type SignedUpload = {
  uploadUrl: string
  apiKey: string
  timestamp: number
  signature: string
  folder: string
  allowedFormats: string
}

/**
 * Signs a Cloudinary upload request server-side so the browser can POST the
 * file bytes directly to Cloudinary — this server never buffers them.
 *
 * `allowed_formats` is signed alongside the folder so the declared MIME type
 * is enforced by Cloudinary, not merely checked by us before handing out a
 * signature. Without it, a caller could ask to upload a PNG and then send
 * anything at all to the endpoint we just signed for them.
 */
export function createSignedUpload(folderSuffix: UploadFolder, mimeType: string): SignedUpload {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET

  // These are non-null-asserted in the original. A missing key produced a
  // signature computed over `undefined`, which Cloudinary rejects with an
  // opaque error at upload time rather than here, where the cause is obvious.
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary is not configured: set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET')
  }

  if (!UPLOAD_FOLDERS.includes(folderSuffix)) {
    throw new Error(`Refusing to sign an upload for unknown folder "${folderSuffix}"`)
  }

  const formats = MIME_TO_FORMATS[mimeType]
  if (!formats) {
    // Reaches the user through the presign route's error body, so it reads as
    // guidance rather than as an internal refusal.
    throw new ApiError(
      400,
      'UNSUPPORTED_FILE_TYPE',
      'That file type isn\'t supported. Please use a JPG, PNG, WebP, GIF or AVIF image, or a PDF for invoices.',
    )
  }

  const folder = `${rootFolder}/${folderSuffix}`
  const timestamp = Math.round(Date.now() / 1000)
  const allowedFormats = formats.join(',')

  // Every param sent to Cloudinary's signed upload endpoint besides file,
  // api_key, timestamp and signature itself must be included here, or the
  // signature won't match what the client actually sends.
  const signature = cloudinary.utils.api_sign_request(
    { timestamp, folder, allowed_formats: allowedFormats },
    apiSecret,
  )

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    apiKey,
    timestamp,
    signature,
    folder,
    allowedFormats,
  }
}

/**
 * Deletes an image from Cloudinary by its public_id.
 */
export async function deleteImage(publicId: string): Promise<void> {
  await cloudinary.uploader.destroy(publicId)
}

/**
 * Derives a Cloudinary public_id from a delivery URL stored in the database
 * (e.g. https://res.cloudinary.com/<cloud>/image/upload/v169.../products/abc.jpg
 * -> "inventory/products/abc"). Returns null if the URL doesn't look like a
 * Cloudinary delivery URL.
 */
export function getPublicIdFromUrl(url: string): string | null {
  const marker = '/upload/'
  const idx = url.indexOf(marker)
  if (idx === -1) return null

  let rest = url.slice(idx + marker.length)
  rest = rest.replace(/^v\d+\//, '') // strip the version segment, if present
  const dotIdx = rest.lastIndexOf('.')
  if (dotIdx !== -1) rest = rest.slice(0, dotIdx) // strip the file extension

  return rest || null
}

/**
 * Validates a URL before it is persisted as a product or invoice asset.
 *
 * Image URLs used to be stored exactly as the client sent them. next/image
 * would refuse to render a foreign host (remotePatterns), but the value still
 * reached the database and any consumer that didn't go through next/image —
 * the PDF export, a future email — would happily follow it.
 */
export function isTrustedAssetUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === 'res.cloudinary.com'
  } catch {
    return false
  }
}
