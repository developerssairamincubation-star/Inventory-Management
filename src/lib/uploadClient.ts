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

export async function uploadFile(file: File, folder: string, authFetch: AuthFetch): Promise<string> {
  const presignRes = await authFetch('/api/upload/presign', {
    method: 'POST',
    body: JSON.stringify({ mimeType: file.type, folder }),
  });

  if (!presignRes.ok) {
    throw new Error(`Failed to get upload params: ${await presignRes.text()}`);
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
    throw new Error(`Upload to Cloudinary failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }

  const uploaded = (await uploadRes.json()) as { secure_url: string };
  return uploaded.secure_url;
}
