import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

const region = process.env.AWS_REGION!
const bucket = process.env.AWS_S3_BUCKET_NAME!

// Support optional custom endpoints (e.g. MinIO / LocalStack)
const endpoint = process.env.AWS_S3_ENDPOINT || undefined

export const s3Client = new S3Client({
  region,
  endpoint,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  // Required when using path-style URLs with custom endpoints
  forcePathStyle: !!endpoint,
})

/**
 * Uploads a file buffer to S3 and returns the public URL.
 *
 * @param key       - The S3 object key (e.g. "products/product-123.jpg")
 * @param body      - The file contents as a Buffer or Uint8Array
 * @param mimeType  - The MIME type of the file (e.g. "image/jpeg")
 * @returns         - The public URL of the uploaded object
 */
export async function uploadToS3(
  key: string,
  body: Buffer | Uint8Array,
  mimeType: string
): Promise<string> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: mimeType,
      // Public read is granted via bucket policy (not ACL), which is the
      // recommended approach for S3 buckets created after April 2023.
    })
  )

  return getPublicUrl(key)
}

/**
 * Deletes an object from S3 by its key.
 *
 * @param key - The S3 object key (e.g. "products/product-123.jpg")
 */
export async function deleteFromS3(key: string): Promise<void> {
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  )
}

/**
 * Builds the public URL for a key without uploading anything — used by the
 * presigned-upload flow, where the client uploads directly to storage and
 * the server only needs to hand back the URL the object will end up at.
 */
export function getPublicUrl(key: string): string {
  if (endpoint) {
    return `${endpoint}/${bucket}/${key}`
  }
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`
}

/**
 * Derives an S3 key from a full S3 URL stored in the database.
 * Returns null if the URL is not an S3 URL for this bucket.
 */
export function getS3KeyFromUrl(url: string): string | null {
  try {
    const base = endpoint
      ? `${endpoint}/${bucket}/`
      : `https://${bucket}.s3.${region}.amazonaws.com/`
    if (url.startsWith(base)) return url.slice(base.length)
    return null
  } catch {
    return null
  }
}
