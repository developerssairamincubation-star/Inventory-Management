// Different API routes return their error in different shapes depending on
// whether they use the centralized fromError()/fail() helpers
// ({ success: false, error: { code, message } }) or an older ad-hoc
// { error: "some string" } shape (see src/lib/api/response.ts /
// src/lib/api/classifyError.ts) — both are safe, user-facing text either
// way, but code that blindly does `data.error || fallback` breaks the
// moment `data.error` is the object shape, producing a literal
// "[object Object]" message. This normalizes either shape to a plain string.
/** How many individual field problems to spell out before summarising the rest. */
const MAX_LISTED_DETAILS = 4;

export function extractErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const err = (data as { error?: unknown }).error;
  if (typeof err === "string" && err) return err;

  if (err && typeof err === "object") {
    // A validation failure carries one entry per offending field
    // (src/lib/validation.ts parseBody). Listing them all matters for a form
    // like the invoice upload: showing only the first means a 22-line invoice
    // is fixed one rejected submit at a time. `detail` is the human sentence
    // ("Line 4: unit cost can have at most 2 decimal places"); `message` is
    // the bare rule text, kept as a fallback for older responses.
    const details = (err as { details?: unknown }).details;
    if (Array.isArray(details) && details.length > 0) {
      const sentences = details
        .map((d) => {
          if (!d || typeof d !== "object") return null;
          const detail = (d as { detail?: unknown }).detail;
          if (typeof detail === "string" && detail) return detail;
          const field = (d as { field?: unknown }).field;
          const message = (d as { message?: unknown }).message;
          if (typeof message === "string" && message) {
            return typeof field === "string" && field ? `${field} ${message}` : message;
          }
          return null;
        })
        .filter((x): x is string => Boolean(x));

      if (sentences.length === 1) return sentences[0];
      if (sentences.length > 1) {
        const shown = sentences.slice(0, MAX_LISTED_DETAILS);
        const remaining = sentences.length - shown.length;
        return remaining > 0
          ? `${shown.join("; ")} — and ${remaining} more problem${remaining === 1 ? "" : "s"}.`
          : shown.join("; ");
      }
    }

    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

/** Reads a failed Response and returns text safe to show a user. */
export async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    return extractErrorMessage(await res.json(), fallback);
  } catch {
    return fallback;
  }
}
