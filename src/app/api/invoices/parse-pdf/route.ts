import { NextRequest } from "next/server";
import { requireUser } from "@/lib/authz";
import { fail, fromError, ok } from "@/lib/api/response";
import { rateLimit, RULES } from "@/lib/rateLimit";
import { logger, requestIdFrom } from "@/lib/logger";
import { GeminiNotConfiguredError, GeminiParseError, parseInvoicePdf, type ParsedInvoice } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel-specific function timeout hint (no-op on self-hosted Docker).
export const maxDuration = 60;

export type { ParsedInvoice };

// The whole upload was buffered into memory and then base64-encoded for the
// Gemini call — a 200MB file became roughly 470MB resident, with nothing
// capping it. Real supplier invoices are a few hundred KB.
const MAX_PDF_BYTES = 10 * 1024 * 1024;

// %PDF- . file.type is client-declared and trivially spoofed, so the bytes
// themselves are checked before anything is sent to a metered API.
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const { user } = auth;
  const requestId = requestIdFrom(request);

  try {
    // Per-user quota on top of the per-IP limit the middleware applies. This
    // endpoint spends real money on every call; an IP limit alone doesn't cap
    // what one authenticated account can run up.
    const quota = await rateLimit(`parse-pdf:user:${user.user_id}`, RULES.expensive);
    if (!quota.allowed) {
      return fail(429, "RATE_LIMITED", "You've reached the invoice-scanning limit for now. Please try again later, or enter the details manually.");
    }

    const formData = await request.formData();
    const file = formData.get("pdf");

    if (!file || typeof file === "string") {
      return fail(400, "VALIDATION_ERROR", "No PDF file provided");
    }
    if (file.size > MAX_PDF_BYTES) {
      return fail(413, "FILE_TOO_LARGE", `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_PDF_BYTES / 1024 / 1024}MB.`);
    }
    if (file.size === 0) {
      return fail(400, "VALIDATION_ERROR", "That file is empty");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
      return fail(400, "VALIDATION_ERROR", "That file isn't a PDF");
    }

    const parsed = await parseInvoicePdf(buffer);
    logger.info("Invoice parsed", { requestId, userId: user.user_id, bytes: file.size, lineItems: parsed.products.length });

    return ok(parsed);
  } catch (error) {
    if (error instanceof GeminiNotConfiguredError) {
      // error.message names the AI provider and its env var — useful in the
      // server log, never in a client-visible response.
      logger.error("Invoice parsing is not configured", { requestId, route: "POST /api/invoices/parse-pdf" }, error);
      return fail(501, "NOT_CONFIGURED", "Invoice scanning isn't available right now. Please enter the invoice details manually.");
    }
    if (error instanceof GeminiParseError) {
      logger.warn("Gemini could not parse the invoice", { requestId, userId: user.user_id }, error);
      return fail(502, "PARSE_FAILED", "We couldn't read this invoice. Please check the file and try again, or enter the details manually.");
    }
    return fromError(error, { requestId, userId: user.user_id, route: "POST /api/invoices/parse-pdf" });
  }
}
