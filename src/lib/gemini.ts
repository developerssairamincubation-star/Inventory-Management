// Gemini-based invoice PDF parsing — replaces the old regex/heuristic
// text-extraction approach (src/app/api/invoices/parse-pdf/route.ts used to
// run pdf-parse + hand-written pattern matching). Sending the raw PDF
// directly to Gemini's native file understanding is simpler and more
// robust than pre-extracting text ourselves.
//
// Lazy client, same reasoning as src/db/client.ts: `next build` imports
// every route module during page-data-collection, so an eager throw here
// (e.g. on a missing API key) would crash the build itself, not just
// requests missing the key.
import { GoogleGenAI } from "@google/genai";

export class GeminiNotConfiguredError extends Error {
  constructor() {
    super("Invoice AI parsing is not configured. Set GEMINI_API_KEY.");
    this.name = "GeminiNotConfiguredError";
  }
}

let client: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiNotConfiguredError();
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

export type ParsedInvoiceProduct = {
  product_name: string;
  quantity: number;
  unit_price: number;
  total: number;
};

export type ParsedInvoice = {
  supplier_name: string;
  delivery_date: string;
  invoice_number: string;
  total_amount: number;
  products: ParsedInvoiceProduct[];
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    supplier_name: { type: "string", description: "The vendor/supplier/company name on the invoice" },
    delivery_date: { type: "string", description: "Delivery or invoice date, formatted YYYY-MM-DD" },
    invoice_number: { type: "string", description: "The invoice/bill/order number" },
    total_amount: {
      type: "number",
      description:
        "The invoice's own printed grand/final total — the actual amount payable, exactly as printed (usually near the bottom, labeled Total/Grand Total/Amount Due). This often includes shipping, freight, tax/GST/VAT, and discounts, so it can legitimately differ from the sum of the product line totals below — extract it as printed, do not compute it yourself. Only if the document truly has no total printed anywhere, fall back to the sum of the product line totals.",
    },
    products: {
      type: "array",
      description:
        "Only genuine purchased products/line items. Exclude shipping, freight, delivery, handling, insurance, tax/GST/VAT, discount, rounding, or any other non-product charge row, even if it appears in the same line-items table.",
      items: {
        type: "object",
        properties: {
          product_name: {
            type: "string",
            description:
              "A short, human-readable product name a warehouse worker would recognize at a glance — not the full manufacturer/supplier catalog description. Strip tolerances, packaging/compliance codes, and long part numbers. ALWAYS keep the specific model/variant when one is present — e.g. 'ESP32-C3', 'ESP32-S3', and 'ESP8266' are different products and must never be collapsed into a shared name like 'ESP32' or 'ESP module'. Example: '[R195500] RK10J11R0A0H-ALPSALPINE-±30% 30mW 10kΩ SMD Potentiometers, Variable Resistors ROHS' -> '10kΩ SMD Potentiometer'.",
          },
          quantity: {
            type: "number",
            description: "The number of units of this line item being purchased, from the invoice's own quantity/qty column — not a pack size, case count, or row/serial number.",
          },
          unit_price: { type: "number", description: "Price per single unit, as printed on the invoice." },
          total: { type: "number", description: "The line item's total price (quantity × unit price), as printed on the invoice." },
        },
        required: ["product_name", "quantity", "unit_price", "total"],
      },
    },
  },
  required: ["supplier_name", "delivery_date", "invoice_number", "total_amount", "products"],
} as const;

const EXTRACTION_PROMPT = `You are extracting structured data from a supplier/purchase invoice PDF.
Return the supplier name, the delivery or invoice date (formatted YYYY-MM-DD), the invoice number, the invoice's own printed grand total, and every line-item product with its quantity, unit price, and line total.

For total_amount: use the actual final total printed on the invoice (labeled something like Total / Grand Total / Amount Due), not a value you compute. This printed total often bakes in shipping, tax, and discounts, so it can legitimately differ from the sum of the product line totals — that's expected, extract it as-is. Only compute a fallback (sum of the product lines) if the document genuinely has no total printed anywhere.

For product_name: give a short, human-recognizable name, not the full manufacturer/supplier catalog string. Strip tolerances, packaging/compliance codes (RoHS, etc.), and long part numbers unless the part number is the only thing distinguishing this item from a similar one on the same invoice. Always preserve the specific model/variant when the invoice states one — different variants are different products and must never be merged into one generic name (e.g. keep "ESP32-C3" as "ESP32-C3", not shortened to "ESP32").

For quantity: use the invoice's own quantity/qty column for that line — the count of units being purchased, not a pack size, case count, or row/serial number. Double-check this against the line total (quantity × unit_price should equal total) before finalizing it.

Only include genuine purchased products in the products array. Do NOT include shipping, freight, delivery, handling, packing, insurance, tax/GST/VAT, discount, rounding, or other non-product charge lines, even if they appear as their own row in the invoice's line-items table.

If a field genuinely isn't present in the document, use an empty string (or an empty array for products) — do not guess or fabricate values.`;

export class GeminiParseError extends Error {}

export async function parseInvoicePdf(pdfBuffer: Buffer): Promise<ParsedInvoice> {
  const ai = getGeminiClient();

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "application/pdf", data: pdfBuffer.toString("base64") } },
          { text: EXTRACTION_PROMPT },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) throw new GeminiParseError("Gemini returned an empty response");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GeminiParseError("Gemini returned malformed JSON");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as ParsedInvoice).supplier_name !== "string" ||
    !Array.isArray((parsed as ParsedInvoice).products)
  ) {
    throw new GeminiParseError("Gemini response did not match the expected invoice shape");
  }

  return parsed as ParsedInvoice;
}
