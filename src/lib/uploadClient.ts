// Client-side helper for the signed direct-to-Cloudinary upload flow: ask
// the server for signed upload params, then POST the file straight to
// Cloudinary — the Next.js server never buffers the file bytes.
export type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>;

type SignedUpload = {
  uploadUrl: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  allowedFormats: string;
};

/**
 * Image types the server will actually sign an upload for — mirrors
 * MIME_TO_FORMATS in src/lib/cloudinary.ts.
 *
 * The file inputs used to say accept="image/*", which lets the OS picker offer
 * HEIC (what an iPhone photo is by default), BMP, TIFF and SVG. Those reached
 * the presign route and were rejected there, so choosing an ordinary phone
 * photo failed with a raw schema error. Narrow the picker instead, and check
 * again here in case a file arrives by drag-and-drop.
 */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'] as const;

/** For an <input type="file"> accept attribute. */
export const ACCEPTED_IMAGE_ACCEPT = ACCEPTED_IMAGE_TYPES.join(',');

/** Human list for error messages — "JPG, PNG, WebP, GIF or AVIF". */
export const ACCEPTED_IMAGE_LABEL = 'JPG, PNG, WebP, GIF or AVIF';

/**
 * Returns null when the file is fine, or a message to show the user.
 * Checked before uploading so an unsupported photo is reported as such rather
 * than as a signing failure.
 */
export function checkImageFile(file: File): string | null {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    const ext = file.name.includes('.') ? file.name.split('.').pop()!.toUpperCase() : 'that';
    return `${ext} images aren't supported. Please use ${ACCEPTED_IMAGE_LABEL} — on an iPhone, Settings › Camera › Formats › Most Compatible saves photos as JPG.`;
  }
  return null;
}

export async function uploadFile(file: File, folder: string, authFetch: AuthFetch): Promise<string> {
  const problem = checkImageFile(file);
  if (folder === 'products' && problem) throw new Error(problem);

  const presignRes = await authFetch('/api/upload/presign', {
    method: 'POST',
    body: JSON.stringify({ mimeType: file.type, folder }),
  });

  if (!presignRes.ok) {
    const body = await presignRes.json().catch(() => null);
    const message = (body as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message || "Couldn't prepare the upload. Please try again.");
  }

  const { uploadUrl, apiKey, timestamp, signature, folder: signedFolder, allowedFormats } =
    (await presignRes.json()) as SignedUpload;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('api_key', apiKey);
  formData.append('timestamp', String(timestamp));
  formData.append('signature', signature);
  formData.append('folder', signedFolder);
  // Signed by the server alongside the folder, so Cloudinary enforces the file
  // type rather than trusting the type we claimed when asking for a signature.
  formData.append('allowed_formats', allowedFormats);

  const uploadRes = await fetch(uploadUrl, { method: 'POST', body: formData });

  if (!uploadRes.ok) {
    // The provider's own body is JSON with an error.message; fall back to the
    // status when it is something else entirely.
    const body = await uploadRes.json().catch(() => null);
    const detail = (body as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(detail ? `Upload failed: ${detail}` : `Upload failed (${uploadRes.status}). Please try again.`);
  }

  const uploaded = (await uploadRes.json()) as { secure_url: string };
  return uploaded.secure_url;
}
