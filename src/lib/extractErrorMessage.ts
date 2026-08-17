// Different API routes return their error in different shapes depending on
// whether they use the centralized fromError()/fail() helpers
// ({ success: false, error: { code, message } }) or an older ad-hoc
// { error: "some string" } shape (see src/lib/api/response.ts /
// src/lib/api/classifyError.ts) — both are safe, user-facing text either
// way, but code that blindly does `data.error || fallback` breaks the
// moment `data.error` is the object shape, producing a literal
// "[object Object]" message. This normalizes either shape to a plain string.
export function extractErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const err = (data as { error?: unknown }).error;
  if (typeof err === "string" && err) return err;
  if (err && typeof err === "object") {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}
