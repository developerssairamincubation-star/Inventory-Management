import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, unauthorizedResponse } from "@/lib/authMiddleware";
import { GeminiNotConfiguredError, GeminiParseError, parseInvoicePdf, type ParsedInvoice } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      return NextResponse.json({ error: error.message }, { status: 501 });
    }
    if (error instanceof GeminiParseError) {
      console.error("[parse-pdf] Gemini parse error:", error);
      return NextResponse.json({ error: "Could not parse invoice" }, { status: 502 });
    }
    console.error("[parse-pdf] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to parse PDF" },
      { status: 500 }
    );
  }
}
