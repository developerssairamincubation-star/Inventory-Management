// Client-side helper for the presigned direct-to-storage upload flow: ask
// the server for a short-lived presigned PUT URL, then PUT the file bytes
// straight to storage — the Next.js server never buffers them. Replaces the
// old pattern of POSTing a FormData body to /api/upload.
export type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function uploadFile(file: File, folder: string, authFetch: AuthFetch): Promise<string> {
  const presignRes = await authFetch('/api/upload/presign', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, mimeType: file.type, folder }),
  });

  if (!presignRes.ok) {
    throw new Error(`Failed to get upload URL: ${await presignRes.text()}`);
  }

  const { uploadUrl, url } = (await presignRes.json()) as { uploadUrl: string; url: string };

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  });

  if (!putRes.ok) {
    throw new Error(`Upload to storage failed: ${putRes.status} ${await putRes.text()}`);
  }

  return url;
}
