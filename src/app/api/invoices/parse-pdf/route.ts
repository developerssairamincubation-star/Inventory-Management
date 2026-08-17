import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, unauthorizedResponse } from "@/lib/authMiddleware";
import { GeminiNotConfiguredError, GeminiParseError, parseInvoicePdf, type ParsedInvoice } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel-specific function timeout hint (no-op on self-hosted Docker).
// Default is 10s on Hobby / lower Pro tiers, too short for a Gemini PDF
// parse round-trip on a larger invoice.
export const maxDuration = 60;

export type { ParsedInvoice };

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorizedResponse();

  try {
    const formData = await request.formData();
    const file = formData.get("pdf") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No PDF file provided" }, { status: 400 });
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "File must be a PDF" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseInvoicePdf(buffer);

    return NextResponse.json(parsed);
  } catch (error) {
    if (error instanceof GeminiNotConfiguredError) {
      // error.message names the AI provider and its env var — useful in the
      // server log, never in a client-visible response.
      console.error("[parse-pdf] not configured:", error.message);
      return NextResponse.json({ error: "Invoice scanning isn't available right now. Please enter the invoice details manually." }, { status: 501 });
    }
    if (error instanceof GeminiParseError) {
      console.error("[parse-pdf] Gemini parse error:", error);
      return NextResponse.json({ error: "We couldn't read this invoice. Please check the file and try again, or enter the details manually." }, { status: 502 });
    }
    // Any other failure (e.g. a raw error from the underlying AI SDK) is
    // logged in full here and never forwarded to the client verbatim.
    console.error("[parse-pdf] error:", error);
    return NextResponse.json(
      { error: "We couldn't read this invoice. Please check the file and try again, or enter the details manually." },
      { status: 500 }
    );
  }
}
