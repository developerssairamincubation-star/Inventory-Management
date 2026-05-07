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
  const trimmed = raw.trim();
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmy = trimmed.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? `20${y}` : y;
    const month = parseInt(m);
    const day = parseInt(d);
    // Validate day and month
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
  }

  // Month name formats: "31 January 2025" or "January 31, 2025"
  const months: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12",
    jan: "01", feb: "02", mar: "03", apr: "04", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const named = trimmed.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (named) {
    const [, d, mName, y] = named;
    const m = months[mName.toLowerCase()];
    if (m) return `${y}-${m}-${d.padStart(2, "0")}`;
  }
  const named2 = trimmed.match(/([A-Za-z]+)\s+(\d{1,2})[,\s]+(\d{4})/);
  if (named2) {
    const [, mName, d, y] = named2;
    const m = months[mName.toLowerCase()];
    if (m) return `${y}-${m}-${d.padStart(2, "0")}`;
  }

  // European format: DD/MM/YYYY with leading zeros
  const dmyAlt = trimmed.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmyAlt) {
    const [, d, m, y] = dmyAlt;
    return `${y}-${m}-${d}`;
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
  let products: ParsedProduct[] = [];

  // ── Supplier / Vendor name ──────────────────────────────────────────────
  // Look in entire document (supplier often at top OR bottom)
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
    /party\s*(?:name)?[:\-]\s*(.+)/i,
    /registered\s*name[:\-]\s*(.+)/i,
  ];

  // First try: explicit labels
  for (const line of lines) {
    for (const pat of supplierPatterns) {
      const m = line.match(pat);
      if (m) { supplier_name = m[1].trim(); break; }
    }
    if (supplier_name) break;
  }

  // Second try: look for company names with keywords
  if (!supplier_name) {
    for (const line of lines) {
      // Skip common table/label lines and short lines
      if (line.length < 5) continue;
      if (/^\d+|description|hsn|rate|qty|disc|amount|igst|discount|total|customer|shipping|invoice|date|reference|sale order|no\:|place of supply/i.test(line)) continue;

      // Look for lines with company keywords followed by "LIMITED"
      if (/(?:macfos|company|business|firm|pvt|ltd|inc|corp).*limited/i.test(line)) {
        supplier_name = line.trim();
        break;
      }
    }
  }

  // Third try: look for robu.in or similar domain names
  if (!supplier_name) {
    for (const line of lines) {
      if (/robu\.?in|info@|website/i.test(line)) {
        supplier_name = line.match(/robu\.?in/i) ? 'robu.in' : line.trim();
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
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pat of datePatterns) {
      const m = line.match(pat);
      if (m) {
        const d = extractDate(m[1]);
        if (d) { delivery_date = d; break; }
      }
    }
    if (delivery_date) break;

    // If the date label is on this line but empty, check next line
    if (/^(?:invoice\s*date|delivery\s*date|bill\s*date|order\s*date)[:\-]?\s*$/i.test(line) && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const d = extractDate(nextLine);
      if (d) { delivery_date = d; break; }
    }
  }

  // ── Invoice number ──────────────────────────────────────────────────────
  const invPatterns = [
    /invoice\s*(?:no|number|#|num)[:\-\s]*([A-Z0-9\/\-\s]+)/i,
    /inv\s*(?:no|#|number)[:\-\s]*([A-Z0-9\/\-\s]+)/i,
    /bill\s*(?:no|number|#)[:\-\s]*([A-Z0-9\/\-\s]+)/i,
    /order\s*(?:no|number|#)[:\-\s]*([A-Z0-9\/\-\s]+)/i,
    /receipt\s*(?:no|number|#)[:\-\s]*([A-Z0-9\/\-\s]+)/i,
    /po\s*(?:no|number|#)[:\-\s]*([A-Z0-9\/\-\s]+)/i,
    /reference\s*(?:no|number|#)[:\-\s]*([A-Z0-9\/\-\s]+)/i,
  ];
  for (const line of lines) {
    for (const pat of invPatterns) {
      const m = line.match(pat);
      if (m) {
        const raw = m[1].trim();
        invoice_number = raw.split(/[\s\n]/)[0].substring(0, 50);
        break;
      }
    }
    if (invoice_number) break;
  }

  // ── Product line items ──────────────────────────────────────────────────
  // Strategy 1: Detect numbered item rows (like "1 \t Product Name")
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];

    // Look for pattern: digit(s) followed by tab/multiple spaces, then product name
    const itemMatch = line.match(/^(\d+)\s{2,}(.+)$/);
    if (!itemMatch) continue;

    const itemNum = parseInt(itemMatch[1]);
    if (itemNum < 1 || itemNum > 999) continue;

    let productName = itemMatch[2].trim();
    let priceLineIdx = i + 1;

    // Handle multi-line product names (collect until we hit a price line)
    while (priceLineIdx < lines.length) {
      const nextLine = lines[priceLineIdx];

      // Check if this looks like a price line (has currency symbols or numbers like HSN codes)
      if (/₹|[0-9]{5,}|^\d+\s+₹/.test(nextLine)) {
        break;
      }

      // If it's a short line and looks like product name continuation, append
      if (nextLine.length < 100 && !/^\d|discount|total|tax|gst|igst/i.test(nextLine)) {
        productName += " " + nextLine;
        priceLineIdx++;
      } else {
        break;
      }
    }

    // Now extract price data from the price line(s)
    if (priceLineIdx < lines.length) {
      const priceLine = lines[priceLineIdx];
      const nums = priceLine.match(/\d[\d,]*(?:\.\d+)?/g);

      if (nums && nums.length >= 3) {
        // Format: HSN Rate Qty Disc Amount IGST
        // We need Qty (usually 3rd-5th number), Rate (2nd number), Amount (around 5th)
        const values = nums.map(parseNum);

        let qty = 0, unit_price = 0, total = 0;

        // Common pattern: HSN(code) Rate Qty Amount IGST(%)
        // Find Qty by looking for which multiplication matches: Qty * Rate = Amount
        for (let a = 0; a < Math.min(values.length - 1, 5); a++) {
          for (let b = 0; b < Math.min(values.length - 1, 5); b++) {
            if (a === b) continue;
            for (let c = 0; c < values.length; c++) {
              if (c === a || c === b) continue;
              // Check if a * b = c (approximately, with some tolerance)
              if (values[a] > 0 && values[b] > 0 && Math.abs(values[a] * values[b] - values[c]) < values[c] * 0.05) {
                qty = values[a];
                unit_price = values[b];
                total = values[c];
                break;
              }
            }
            if (qty > 0) break;
          }
          if (qty > 0) break;
        }

        // Fallback: assume Qty is small number (typically 1-100), Rate is larger
        if (qty <= 0 && values.length >= 3) {
          const candidates = values.filter(v => v > 0);
          if (candidates.length >= 3) {
            qty = candidates[0];
            unit_price = candidates[1];
            total = candidates[candidates.length - 1];
          }
        }

        const cleanName = sanitiseProductName(productName);
        if (qty > 0 && unit_price > 0 && isMeaningfulProductName(cleanName)) {
          products.push({ product_name: cleanName, quantity: qty, unit_price, total });
        }
      }
    }
  }

  // Strategy 2: Flexible pattern-based matching (tabs or multiple spaces)
  if (products.length === 0) {
    const linePattern = /^(.+?)\s+(\d[\d,]*(?:\.\d+)?)\s+(\d[\d,]*(?:\.\d+)?)\s+(\d[\d,]*(?:\.\d+)?)$/;
    for (const line of lines) {
      if (!line.trim()) continue;
      const m = line.match(linePattern);
      if (!m) continue;
      const [, name, a, b, c] = m;
      if (/total|tax|gst|cgst|sgst|igst|discount|freight|subtotal|hsn|rate|qty|desc/i.test(name)) continue;
      const cleanName = sanitiseProductName(name);
      if (!isMeaningfulProductName(cleanName)) continue;
      const qty = parseNum(a), unit_price = parseNum(b), total = parseNum(c);
      if (qty <= 0 || unit_price <= 0) continue;
      products.push({ product_name: cleanName, quantity: qty, unit_price, total });
    }
  }

  // Strategy 3: Header detection (for other invoice formats)
  if (products.length === 0) {
    const headerIdx = lines.findIndex((l) =>
      /(?:item|product|description|particulars).+(?:qty|quantity).+(?:rate|price|unit).+(?:amount|total)/i.test(l) ||
      /(?:qty|quantity).+(?:rate|price|unit).+(?:amount|total)/i.test(l)
    );

    if (headerIdx !== -1) {
      for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*(sub[\s-]?total|grand\s*total|total\s*amount|net\s*amount|balance|taxes?|gst|cgst|sgst|igst|discount|freight|shipping|vat)\b/i.test(line)) break;
        if (!line.trim()) continue;

        const nums = line.match(/\d[\d,]*(?:\.\d+)?/g);
        if (!nums || nums.length < 2) continue;

        const namepart = sanitiseProductName(
          line.replace(/\d[\d,]*(?:\.\d+)?/g, " ").trim()
        );

        if (!isMeaningfulProductName(namepart)) continue;

        const values = nums.map(parseNum);
        let qty = 0, unit_price = 0, total = 0;

        if (values.length >= 3) {
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
  }

  // Remove duplicates and ensure unique products
  const seen = new Set<string>();
  products = products.filter((p) => {
    const key = sanitiseProductName(p.product_name).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

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
