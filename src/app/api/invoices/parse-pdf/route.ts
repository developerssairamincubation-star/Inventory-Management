import { NextRequest, NextResponse } from "next/server";
// This version of pdf-parse exports a PDFParse class, not a callable function.
// Usage: new PDFParse({ data: buffer }).getText() → { text, pages, total }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse } = require("pdf-parse");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type ParsedProduct = {
  product_name: string;
  quantity: number;
  unit_price: number;
  total: number;
};

export type ParsedInvoice = {
  supplier_name: string;
  delivery_date: string; // YYYY-MM-DD
  invoice_number: string;
  products: ParsedProduct[];
  raw_text: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Try to parse a date string into YYYY-MM-DD; returns empty string if fail */
function normaliseDate(raw: string): string {
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = raw.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // MM/DD/YYYY (US format fallback)
  const mdy = raw.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  if (mdy) {
    const [, m, d, y] = mdy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Month name formats: "31 January 2025" or "January 31, 2025"
  const months: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12",
    jan: "01", feb: "02", mar: "03", apr: "04", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const named = raw.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (named) {
    const [, d, mName, y] = named;
    const m = months[mName.toLowerCase()];
    if (m) return `${y}-${m}-${d.padStart(2, "0")}`;
  }
  const named2 = raw.match(/([A-Za-z]+)\s+(\d{1,2})[,\s]+(\d{4})/);
  if (named2) {
    const [, mName, d, y] = named2;
    const m = months[mName.toLowerCase()];
    if (m) return `${y}-${m}-${d.padStart(2, "0")}`;
  }

  return "";
}

/** Extract the first date-like string from a text fragment */
function extractDate(text: string): string {
  // ISO
  let m = text.match(/\d{4}-\d{2}-\d{2}/);
  if (m) return normaliseDate(m[0]);
  // Delimited
  m = text.match(/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/);
  if (m) return normaliseDate(m[0]);
  // Named month
  m = text.match(/\d{1,2}\s+[A-Za-z]+\s+\d{4}/);
  if (m) return normaliseDate(m[0]);
  m = text.match(/[A-Za-z]+\s+\d{1,2}[,\s]+\d{4}/);
  if (m) return normaliseDate(m[0]);
  return "";
}

/** Parse number from string – handles commas */
function parseNum(s: string): number {
  return parseFloat(s.replace(/,/g, "").trim()) || 0;
}

function sanitiseProductName(raw: string): string {
  return raw
    .replace(/[|_]+/g, " ")
    .replace(/[\u2012-\u2015]/g, "-")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isMeaningfulProductName(name: string): boolean {
  const trimmed = sanitiseProductName(name);
  if (!trimmed) return false;
  if (!/[a-z]/i.test(trimmed)) return false;

  const alphaTokens = trimmed
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  if (alphaTokens.length === 0) return false;

  const fillerTokens = new Set([
    "of", "page", "pages", "subtotal", "total", "amount", "qty", "quantity",
    "rate", "price", "unit", "invoice", "tax", "gst", "cgst", "sgst", "igst",
    "discount", "shipping", "freight", "balance",
  ]);
  const meaningfulTokens = alphaTokens.filter((token) => !fillerTokens.has(token));

  if (meaningfulTokens.length === 0) return false;
  if (/^[-\s]*of[-\s]*$/i.test(trimmed)) return false;

  return meaningfulTokens.some((token) => /[a-z]/.test(token) && token.length > 1);
}

// ---------------------------------------------------------------------------
// Core parsing logic
// ---------------------------------------------------------------------------
function parseInvoiceText(text: string): Omit<ParsedInvoice, "raw_text"> {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  let supplier_name = "";
  let delivery_date = "";
  let invoice_number = "";
  const products: ParsedProduct[] = [];

  // ── Supplier / Vendor name ──────────────────────────────────────────────
  const supplierPatterns = [
    /supplier\s*(?:name)?[:\-]\s*(.+)/i,
    /vendor\s*(?:name)?[:\-]\s*(.+)/i,
    /sold\s*by[:\-]\s*(.+)/i,
    /from[:\-]\s*(.+)/i,
    /bill\s*from[:\-]\s*(.+)/i,
    /company\s*(?:name)?[:\-]\s*(.+)/i,
    /manufacturer[:\-]\s*(.+)/i,
    /distributor[:\-]\s*(.+)/i,
    /shipped\s*(?:from|by)[:\-]\s*(.+)/i,
  ];
  for (const line of lines) {
    for (const pat of supplierPatterns) {
      const m = line.match(pat);
      if (m) { supplier_name = m[1].trim(); break; }
    }
    if (supplier_name) break;
  }
  // Fallback: first non-empty line that doesn't look like a label or number
  if (!supplier_name) {
    for (const line of lines.slice(0, 6)) {
      if (!/^\d/.test(line) && !/invoice|receipt|bill|tax|gst|date|no\.|number/i.test(line) && line.length > 3) {
        supplier_name = line;
        break;
      }
    }
  }

  // ── Delivery / Invoice date ─────────────────────────────────────────────
  const datePatterns = [
    /delivery\s*date[:\-]\s*(.+)/i,
    /delivered\s*(?:on)?[:\-]\s*(.+)/i,
    /ship(?:ping|ped)?\s*date[:\-]\s*(.+)/i,
    /date\s*of\s*delivery[:\-]\s*(.+)/i,
    /invoice\s*date[:\-]\s*(.+)/i,
    /bill\s*date[:\-]\s*(.+)/i,
    /order\s*date[:\-]\s*(.+)/i,
    /date[:\-]\s*(.+)/i,
  ];
  for (const line of lines) {
    for (const pat of datePatterns) {
      const m = line.match(pat);
      if (m) {
        const d = extractDate(m[1]);
        if (d) { delivery_date = d; break; }
      }
    }
    if (delivery_date) break;
  }

  // ── Invoice number ──────────────────────────────────────────────────────
  const invPatterns = [
    /invoice\s*(?:no|number|#)[:\-\s]*([A-Z0-9\/\-]+)/i,
    /inv\s*(?:no|#)[:\-\s]*([A-Z0-9\/\-]+)/i,
    /bill\s*(?:no|number|#)[:\-\s]*([A-Z0-9\/\-]+)/i,
    /order\s*(?:no|number|#)[:\-\s]*([A-Z0-9\/\-]+)/i,
    /receipt\s*(?:no|number|#)[:\-\s]*([A-Z0-9\/\-]+)/i,
  ];
  for (const line of lines) {
    for (const pat of invPatterns) {
      const m = line.match(pat);
      if (m) { invoice_number = m[1].trim(); break; }
    }
    if (invoice_number) break;
  }

  // ── Product line items ──────────────────────────────────────────────────
  // Strategy 1: Detect table header row then parse rows below it
  const headerIdx = lines.findIndex((l) =>
    /(?:item|product|description|particulars).+(?:qty|quantity).+(?:rate|price|unit).+(?:amount|total)/i.test(l) ||
    /(?:qty|quantity).+(?:rate|price|unit).+(?:amount|total)/i.test(l)
  );

  if (headerIdx !== -1) {
    // Parse lines after the header until we hit a total/summary line
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(sub[\s-]?total|grand\s*total|total\s*amount|net\s*amount|balance|taxes?|gst|cgst|sgst|igst|discount|freight|shipping|vat)\b/i.test(line)) break;

      // A product line should have at least 3 numeric values (qty, unit price, total)
      const nums = line.match(/\d[\d,]*(?:\.\d+)?/g);
      if (!nums || nums.length < 2) continue;

      // Remove numbers from the line to get the product name
      const namepart = sanitiseProductName(
        line
        .replace(/\d[\d,]*(?:\.\d+)?/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim()
      );

      if (!isMeaningfulProductName(namepart)) continue;

      const values = nums.map(parseNum);
      let qty = 0, unit_price = 0, total = 0;

      if (values.length >= 3) {
        // Try to find qty × unit_price = total relationship
        let found = false;
        for (let a = 0; a < values.length - 2 && !found; a++) {
          for (let b = a + 1; b < values.length - 1 && !found; b++) {
            for (let c = b + 1; c < values.length && !found; c++) {
              if (values[a] > 0 && values[b] > 0 && Math.abs(values[a] * values[b] - values[c]) < 1) {
                qty = values[a]; unit_price = values[b]; total = values[c]; found = true;
              }
            }
          }
        }
        if (!found) {
          // fallback: last 3 values
          [qty, unit_price, total] = values.slice(-3);
        }
      } else {
        [qty, unit_price] = values;
        total = qty * unit_price;
      }

      if (qty <= 0 || unit_price <= 0) continue;

      products.push({ product_name: namepart, quantity: qty, unit_price, total });
    }
  }

  // Strategy 2: Pattern-based product matching across all lines
  if (products.length === 0) {
    // Match lines like: "Product Name   5   200.00   1000.00"
    const linePattern = /^(.+?)\s{2,}(\d[\d,]*(?:\.\d+)?)\s+(\d[\d,]*(?:\.\d+)?)\s+(\d[\d,]*(?:\.\d+)?)$/;
    for (const line of lines) {
      const m = line.match(linePattern);
      if (!m) continue;
      const [, name, a, b, c] = m;
      if (/total|tax|gst|cgst|sgst|igst|discount|freight|subtotal/i.test(name)) continue;
      const cleanName = sanitiseProductName(name);
      if (!isMeaningfulProductName(cleanName)) continue;
      const qty = parseNum(a), unit_price = parseNum(b), total = parseNum(c);
      if (qty <= 0 || unit_price <= 0) continue;
      products.push({ product_name: cleanName, quantity: qty, unit_price, total });
    }
  }

  // Strategy 3: Look for Qty/Rate/Amount on separate adjacent lines
  if (products.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      const qtyLine = lines[i].match(/(?:qty|quantity)[:\s]+(\d[\d,]*(?:\.\d+)?)/i);
      const rateLine = lines[i].match(/(?:rate|price|unit\s*price)[:\s]+(\d[\d,]*(?:\.\d+)?)/i);
      const totalLine = lines[i].match(/(?:amount|total)[:\s]+(\d[\d,]*(?:\.\d+)?)/i);
      if (qtyLine || rateLine || totalLine) {
        // Try to grab context ± 3 lines
        const context = lines.slice(Math.max(0, i - 2), i + 3).join(" ");
        const nums = context.match(/\d[\d,]*(?:\.\d+)?/g)?.map(parseNum) || [];
        const nameMatch = context.match(/(?:item|product|description)[:\s]+([^0-9]+)/i);
        if (nameMatch && nums.length >= 2) {
          const cleanName = sanitiseProductName(nameMatch[1]);
          const qty = nums[0], unit_price = nums[1], total = nums[2] ?? qty * unit_price;
          if (qty > 0 && unit_price > 0 && isMeaningfulProductName(cleanName)) {
            products.push({ product_name: cleanName, quantity: qty, unit_price, total });
          }
        }
      }
    }
  }

  return { supplier_name, delivery_date, invoice_number, products };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("pdf") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No PDF file provided" }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "File must be a PDF" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    const rawText: string = parsed.text || "";

    const extracted = parseInvoiceText(rawText);

    const response: ParsedInvoice = {
      ...extracted,
      raw_text: rawText,
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error("[parse-pdf] error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to parse PDF" },
      { status: 500 }
    );
  }
}
