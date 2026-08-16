import { v2 as cloudinary } from 'cloudinary'

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

export type SignedUpload = {
  uploadUrl: string
  apiKey: string
  timestamp: number
  signature: string
  folder: string
}

/**
 * Signs a Cloudinary upload request server-side so the browser can POST the
 * file bytes directly to Cloudinary — this server never buffers them.
 * Mirrors the old S3 presigned-PUT flow, just with Cloudinary's signed-params
 * scheme instead of a presigned URL (Cloudinary's API endpoint is fixed per
 * cloud, not a URL you construct per-object).
 */
export function createSignedUpload(folderSuffix: string): SignedUpload {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME!
  const apiKey = process.env.CLOUDINARY_API_KEY!
  const apiSecret = process.env.CLOUDINARY_API_SECRET!
  const folder = `${rootFolder}/${folderSuffix}`
  const timestamp = Math.round(Date.now() / 1000)

  // Every param sent to Cloudinary's signed upload endpoint besides file,
  // api_key, timestamp and signature itself must be included here, or the
  // signature won't match what the client actually sends.
  const signature = cloudinary.utils.api_sign_request({ timestamp, folder }, apiSecret)

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    apiKey,
    timestamp,
    signature,
    folder,
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
