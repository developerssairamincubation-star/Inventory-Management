"use client";

import { Fragment, useEffect, useRef, useState, useCallback } from "react";
import ImageCropModal from "@/components/ImageCropModal";
import LoadingState from "@/components/LoadingState";
import { useToast } from "@/components/ui/Toast";
import { authFetch } from "@/contexts/UserContext";
import { uploadFile } from "@/lib/uploadClient";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ParsedProduct = {
  product_name: string;
  quantity: number;
  unit_price: number;
  total: number;
};

type ExistingProduct = {
  product_id: string;
  product_name: string;
  unit_cost: number;
  sku_code?: string;
  product_code?: string;
};

type ItemAction = "add_stock" | "new_product" | "invoice_only";

// One row per invoice line item — the whole review-and-decide flow (used to
// be a one-item-at-a-time modal wizard) now lives inline in this row: the
// Action select decides whether it adds to an existing product's stock,
// creates a brand-new product (category/description/image fields appear in
// an inline sub-row below), or is logged for the invoice only.
type InvoiceRow = {
  product_name: string;
  quantity: number;
  unit_price: number;
  total: number;
  action: ItemAction;
  linkedProductId: string | null; // add_stock target — auto-filled on an exact name match, otherwise picked via the inline search
  linkQuery: string; // search text for the inline "link to existing product" box
  category_id: string; // new_product only
  description: string; // new_product only
  imageFile: File | null; // new_product only
  imagePreview: string | null; // new_product only
  location: string; // free-text storage location (e.g. "R2", "L3") — add_stock/new_product only, saved onto the product's stock row
};

type Props = {
  onClose: () => void;
  existingProducts: ExistingProduct[];
  onSuccess: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normalise(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Exact match only — a substring/fuzzy fallback here would silently
// conflate different product variants (e.g. "ESP32" matching "ESP32-C3" by
// substring containment), merging distinct catalog items and their SKUs
// into one. searchProducts() below still does loose matching for the
// user-driven manual "link to existing product" search, where a human
// picks the right one instead of the system guessing on their behalf.
function findMatch(name: string, products: ExistingProduct[]): ExistingProduct | null {
  if (!name.trim()) return null;
  const n = normalise(name);
  return products.find((p) => normalise(p.product_name) === n) ?? null;
}

function searchProducts(query: string, products: ExistingProduct[]): ExistingProduct[] {
  const q = normalise(query);
  if (!q) return [];

  return products
    .filter((product) => {
      const name = normalise(product.product_name);
      return name.includes(q) || q.includes(name);
    })
    .slice(0, 8);
}

// A row's default action/link is decided once, from whatever name it starts
// with (parsed from the PDF, or blank for a manually added row) — editing
// the name afterward doesn't silently flip a row the user already reviewed.
function createRow(base: Partial<ParsedProduct>, existingProducts: ExistingProduct[]): InvoiceRow {
  const product_name = base.product_name ?? "";
  const match = findMatch(product_name, existingProducts);
  return {
    product_name,
    quantity: base.quantity ?? 1,
    unit_price: base.unit_price ?? 0,
    total: base.total ?? 0,
    action: match ? "add_stock" : "new_product",
    linkedProductId: match?.product_id ?? null,
    linkQuery: "",
    category_id: "",
    description: "",
    imageFile: null,
    imagePreview: null,
    location: "",
  };
}

const isRowTouched = (r: InvoiceRow) => r.product_name.trim() !== "" || r.quantity !== 0 || r.unit_price !== 0;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const lbl: React.CSSProperties = {
  display: "block", fontSize: 10, fontWeight: 600, color: "var(--muted)",
  textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3,
};
const inp: React.CSSProperties = {
  width: "100%", padding: "6px 9px", fontSize: 12,
  border: "1px solid var(--border)", color: "var(--fg)", background: "#fff",
  outline: "none", boxSizing: "border-box",
};
const inpRO: React.CSSProperties = { ...inp, background: "var(--surface, #f8f9fa)", color: "var(--muted)" };
const th: React.CSSProperties = {
  padding: "4px 5px", textAlign: "left", fontSize: 9, fontWeight: 700, color: "var(--muted)",
  textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap",
};
const td: React.CSSProperties = { padding: "4px 5px", verticalAlign: "top" };

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function UploadInvoiceModal({ onClose, existingProducts, onSuccess }: Props) {
  // ── PDF state ──────────────────────────────────────────────────────────────
  const [pdfFile,     setPdfFile]   = useState<File | null>(null);
  const [pdfUrl,      setPdfUrl]    = useState<string | null>(null);
  const [isDragging,  setIsDrag]    = useState(false);
  const [isParsing,   setIsParsing] = useState(false);
  const [parseError,  setParseError] = useState<string | null>(null);

  // ── Form fields (always visible, filled after parsing) ───────────────────
  const [supplierName,  setSupplierName]  = useState("");
  const [deliveryDate,  setDeliveryDate]  = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  // The invoice's own printed grand total — may include shipping/tax/discounts
  // and so can legitimately differ from the items subtotal below. This is
  // what actually gets saved as the invoice's total_amount.
  const [invoiceTotal,  setInvoiceTotal]  = useState<number | "">("");
  const [rows,          setRows]          = useState<InvoiceRow[]>([createRow({}, [])]);
  const [autoInvoiceNo, setAutoInvoiceNo] = useState("");
  // ── Categories — read-only here; created/edited only from Admin Settings ──
  const [categories, setCategories] = useState<{category_id: string; category_name: string}[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { showToast } = useToast();

  // ── Image crop (for new_product rows) ─────────────────────────────────────
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [showCropModal, setShowCropModal] = useState(false);
  const [currentCropRowIdx, setCurrentCropRowIdx] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch next invoice number + categories on mount ──────────────────────
  useEffect(() => {
    // Both are non-critical background prefetches (invoice-number
    // suggestion, category dropdown options) — a failure here doesn't block
    // filling out the form manually, so it's logged for developers rather
    // than interrupting the user with a toast for something they can work
    // around (type the number, leave category unset).
    authFetch("/api/invoices/next-number")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.invoice_no) setAutoInvoiceNo(d.invoice_no); })
      .catch((err) => console.error("[UploadInvoiceModal] next-number prefetch failed:", err));
    authFetch("/api/categories")
      .then((r) => r.ok ? r.json() : [])
      .then((d) => setCategories(Array.isArray(d) ? d : []))
      .catch((err) => console.error("[UploadInvoiceModal] categories prefetch failed:", err));
  }, []);

  // ── File handling ─────────────────────────────────────────────────────────
  const handleFile = useCallback(
    async (file: File) => {
      if (file.type !== "application/pdf") {
        setParseError("Only PDF files are accepted.");
        return;
      }
      setPdfFile(file);
      setPdfUrl(URL.createObjectURL(file));
      setParseError(null);
      setIsParsing(true);
      try {
        const fd = new FormData();
        fd.append("pdf", file);
        const res = await authFetch("/api/invoices/parse-pdf", { method: "POST", body: fd });
        if (!res.ok) {
          // The API route (src/app/api/invoices/parse-pdf/route.ts) already
          // returns a safe, invoice-specific message here — never the AI
          // provider's own error text — so it's fine to show directly.
          const e = await res.json().catch(() => ({}));
          console.error("[UploadInvoiceModal] parse-pdf failed:", e);
          setParseError(e.error || "We couldn't read this invoice. Please check the file and try again, or enter the details manually.");
          return;
        }
        const data = await res.json();
        // Only overwrite a field if the PDF actually returned a value
        if (data.supplier_name)  setSupplierName(data.supplier_name);
        if (data.delivery_date)  setDeliveryDate(data.delivery_date);
        if (data.invoice_number) setInvoiceNumber(data.invoice_number);
        if (typeof data.total_amount === "number" && Number.isFinite(data.total_amount)) {
          setInvoiceTotal(data.total_amount);
        }
        if (data.products?.length > 0) {
          setRows(data.products.map((p: ParsedProduct) => createRow(p, existingProducts)));
        }
      } catch (err) {
        console.error("[UploadInvoiceModal] parse-pdf request failed:", err);
        setParseError(err instanceof Error ? err.message : "We couldn't read this invoice. Please check the file and try again, or enter the details manually.");
      } finally {
        setIsParsing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDrag(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const removePdf = () => {
    setPdfFile(null);
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(null);
    setParseError(null);
  };

  // ── Row helpers ────────────────────────────────────────────────────────────
  const updateRow = (idx: number, patch: Partial<InvoiceRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const updateNumberField = (idx: number, field: "quantity" | "unit_price", val: string) => {
    setRows((prev) => prev.map((r, i) => {
      if (i !== idx) return r;
      const num = parseFloat(val) || 0;
      const next = { ...r, [field]: num };
      next.total = next.quantity * next.unit_price;
      return next;
    }));
  };

  const updateAction = (idx: number, action: ItemAction) => {
    setRows((prev) => prev.map((r, i) => {
      if (i !== idx) return r;
      if (action === "add_stock" && !r.linkedProductId) {
        const match = findMatch(r.product_name, existingProducts);
        return { ...r, action, linkedProductId: match?.product_id ?? null, linkQuery: match ? "" : r.product_name };
      }
      return { ...r, action };
    }));
  };

  const addRow    = () => setRows((prev) => [...prev, createRow({}, existingProducts)]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, j) => j !== i));
  const itemsSubtotal = rows.reduce((s, r) => s + (r.total || 0), 0);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmitClick = () => {
    if (!supplierName.trim()) { showToast("Please enter a supplier name.", "warning"); return; }
    if (!deliveryDate)        { showToast("Please enter a delivery date.", "warning"); return; }

    // Untouched blank rows (e.g. a leftover "+ Add row") are silently
    // skipped rather than blocking submit — same pattern as the Stock
    // List's Add Products form.
    const touched = rows.filter(isRowTouched);
    if (touched.length === 0)                          { showToast("Please add at least one product.", "warning"); return; }
    if (touched.some((r) => !r.product_name.trim()))  { showToast("All products must have a name.", "warning"); return; }
    const unresolved = touched.find((r) => r.action === "add_stock" && !r.linkedProductId);
    if (unresolved) { showToast(`Select an existing product to link "${unresolved.product_name}" to, or change its action.`, "warning"); return; }

    executeSubmit(touched);
  };

  const executeSubmit = async (touchedRows: InvoiceRow[]) => {
    setIsSubmitting(true);
    try {
      const items: Array<{ product_id: string | null; product_name: string; quantity: number; unit_cost: number; total_cost: number; location: string | null }> = [];

      for (const row of touchedRows) {
        let product_id: string | null = null;

        if (row.action === "add_stock") {
          product_id = row.linkedProductId;
        } else if (row.action === "new_product") {
          let image_url: string | undefined;
          if (row.imageFile) {
            try {
              image_url = await uploadFile(row.imageFile, "products", authFetch);
            } catch (uploadErr) {
              console.error("Image upload error:", uploadErr);
            }
          }
          const body: Record<string, unknown> = {
            product_name: row.product_name,
            description: row.description || undefined,
            unit_cost: row.unit_price,
            // Initial stock stays 0 — the invoice's own quantity (added
            // below via POST /api/invoices' per-item stock increment) is
            // what actually sets this product's starting stock. Sending
            // the invoice quantity here too would double-count it.
            quantity: 0,
            ...(image_url ? { image_url } : {}),
          };
          if (row.category_id) body.category_id = row.category_id;
          const res = await authFetch("/api/products", { method: "POST", body: JSON.stringify(body) });
          if (!res.ok) {
            const e = await res.json();
            throw new Error(`Failed to create "${row.product_name}": ${e.error}`);
          }
          const newProd = await res.json();
          product_id = newProd.product?.product_id ?? newProd.product_id;
        }
        // invoice_only rows keep product_id === null

        items.push({
          product_id,
          product_name: row.product_name,
          quantity: row.quantity,
          unit_cost: row.unit_price,
          total_cost: row.total,
          location: row.action !== "invoice_only" && row.location.trim() ? row.location.trim() : null,
        });
      }

      if (items.length === 0) {
        showToast("Please add at least one invoice item.", "warning");
        setIsSubmitting(false);
        return;
      }

      // Upload the source PDF alongside the parsed data — best-effort, same
      // as the product image upload above: a storage hiccup here shouldn't
      // block saving the invoice's actual data.
      let invoice_file_url: string | undefined;
      if (pdfFile) {
        try {
          invoice_file_url = await uploadFile(pdfFile, "invoices", authFetch);
        } catch (uploadErr) {
          console.error("Invoice PDF upload error:", uploadErr);
          showToast("Invoice saved, but the PDF attachment failed to upload.", "warning");
        }
      }

      const invNo = invoiceNumber.trim() || autoInvoiceNo;
      const total_amount = invoiceTotal === "" ? itemsSubtotal : invoiceTotal;
      const res = await authFetch("/api/invoices", { method: "POST", body: JSON.stringify({ invoice_number: invNo, supplier_name: supplierName, received_date: deliveryDate, total_amount, items, ...(invoice_file_url ? { invoice_file_url } : {}) }) });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || "Failed to create invoice");
      }
      showToast("Invoice created successfully! Stock was updated for linked products.", "success");
      onSuccess();
      onClose();
    } catch (err) {
      // Messages reaching here already come from the backend's safe,
      // classified error text (see src/lib/api/classifyError.ts) or from a
      // thrown validation Error above — never raw driver/SDK text.
      console.error("[UploadInvoiceModal] submit failed:", err);
      showToast(err instanceof Error ? `Error: ${err.message}` : "Something went wrong. Please try again.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Main screen ───────────────────────────────────────────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "stretch", justifyContent: "center" }}>
      <div style={{ background: "#fff", width: "100%", maxWidth: 1520, margin: 16, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,.22)" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 20px", borderBottom: "1px solid var(--border)", flexShrink: 0, background: "var(--surface, #f8f9fa)" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--fg)" }}>Upload Invoice</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>Upload a digital PDF — fields are auto-filled and fully editable.</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: "var(--muted)", cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>

          {/* ── LEFT: PDF zone ── */}
          <div style={{ width: "38%", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}>
            {isParsing && (
              <div style={{
                position: "absolute", inset: 0, zIndex: 5, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 10,
                background: "rgba(255,255,255,0.92)",
              }}>
                <LoadingState label="Analysing your invoice" />
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Extracting supplier, dates, total, and line items</div>
              </div>
            )}
            {!pdfFile ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDrag(true); }}
                onDragLeave={() => setIsDrag(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  flex: 1, margin: 20, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", cursor: "pointer",
                  border: isDragging ? "2px dashed var(--accent)" : "2px dashed var(--border)",
                  background: isDragging ? "#eff6ff" : "var(--surface, #f8f9fa)",
                  transition: "all 0.15s",
                }}
              >
                <div style={{ fontSize: 44, marginBottom: 10, opacity: 0.3, lineHeight: 1 }}>↑</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>Drag &amp; drop a PDF here</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                  or <span style={{ color: "var(--accent)", textDecoration: "underline" }}>click to browse</span>
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 10 }}>Digital PDF invoices only.</div>
              </div>
            ) : (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0, background: "var(--surface, #f8f9fa)" }}>
                  <span style={{ fontSize: 13 }}>📄</span>
                  <div style={{ fontSize: 11, color: "var(--fg)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pdfFile.name}</div>
                  {isParsing && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, color: "#1d4ed8", whiteSpace: "nowrap" }}>
                      <span style={{ width: 9, height: 9, border: "2px solid #bfdbfe", borderTopColor: "#1d4ed8", borderRadius: "50%", animation: "invoiceParseSpin 0.8s linear infinite" }} />
                      Parsing…
                    </span>
                  )}
                  <button onClick={removePdf}
                    style={{ fontSize: 11, color: "#b91c1c", background: "none", border: "none", cursor: "pointer", padding: "2px 6px", whiteSpace: "nowrap" }}>Remove</button>
                  <button onClick={() => fileInputRef.current?.click()}
                    style={{ fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: "2px 6px", whiteSpace: "nowrap" }}>Replace</button>
                </div>
                {pdfUrl && (
                  <object data={pdfUrl} type="application/pdf" style={{ flex: 1, width: "100%", minHeight: 0 }}>
                    <div style={{ padding: 20, fontSize: 12, color: "var(--muted)" }}>
                      Cannot display PDF inline.{" "}
                      <a href={pdfUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>Open in new tab</a>
                    </div>
                  </object>
                )}
              </div>
            )}
            {parseError && (
              <div style={{ padding: "8px 16px", fontSize: 11, color: "#b91c1c", borderTop: "1px solid #fca5a5", background: "#fef2f2", flexShrink: 0 }}>⚠ {parseError}</div>
            )}
            <input ref={fileInputRef} type="file" accept="application/pdf" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
          </div>

          {/* ── RIGHT: Always-visible form ── */}
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>

              {isParsing && (
                <div style={{
                  display: "flex", alignItems: "center", padding: "10px 14px",
                  background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4,
                }}>
                  <LoadingState label="Analysing your invoice" />
                </div>
              )}

              {/* Invoice meta */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                  Invoice Details
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <label style={lbl}>Supplier / Merchant Name *</label>
                    <input style={inp} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="e.g. ABC Distributors" />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={lbl}>Delivery Date *</label>
                      <input type="date" style={inp} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
                    </div>
                    <div>
                      <label style={lbl}>Invoice Number</label>
                      <input style={inp} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder={autoInvoiceNo || "e.g. INV-001"} />
                    </div>
                    <div>
                      <label style={lbl}>Invoice Total (₹)</label>
                      <input
                        type="number" min="0" step="0.01" style={inp}
                        value={invoiceTotal}
                        onChange={(e) => setInvoiceTotal(e.target.value === "" ? "" : (parseFloat(e.target.value) || 0))}
                        placeholder={itemsSubtotal.toFixed(2)}
                      />
                    </div>
                  </div>
                  <div style={{ fontSize: 9, color: "var(--muted)", lineHeight: 1.5 }}>
                    This is the total as printed on the invoice, and is what gets saved — it can differ from the items subtotal below (shipping, tax, discounts, etc.). Leave blank to save the items subtotal instead.
                  </div>
                </div>
              </div>

              {/* Products */}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Products &amp; Items</div>
                  <button onClick={addRow} style={{ fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}>+ Add row</button>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        <th style={{ ...th, width: 28 }}>S.No</th>
                        <th style={{ ...th, minWidth: 180 }}>Product Name</th>
                        <th style={{ ...th, width: 60 }}>Qty</th>
                        <th style={{ ...th, width: 80 }}>Unit Cost</th>
                        <th style={{ ...th, width: 80 }}>Total</th>
                        <th style={{ ...th, width: 80 }}>Location/Rack</th>
                        <th style={{ ...th, width: 130 }}>Action</th>
                        <th style={{ ...th, minWidth: 180 }}>Match / Link to Existing</th>
                        <th style={{ ...th, width: 20 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, idx) => {
                        const linkedProduct = row.linkedProductId ? existingProducts.find((p) => p.product_id === row.linkedProductId) : null;
                        const linkMatches = row.action === "add_stock" && !row.linkedProductId
                          ? searchProducts(row.linkQuery, existingProducts)
                          : [];
                        return (
                          <Fragment key={idx}>
                            <tr style={{ borderBottom: row.action === "new_product" ? "none" : "1px solid var(--border)" }}>
                              <td style={{ ...td, fontSize: 11, color: "var(--muted)", paddingTop: 10 }}>{idx + 1}</td>
                              <td style={td}>
                                <input style={inp} value={row.product_name} placeholder="Product name"
                                  onChange={(e) => updateRow(idx, { product_name: e.target.value })} />
                              </td>
                              <td style={td}>
                                <input type="number" min="0" style={inp} value={row.quantity}
                                  onChange={(e) => updateNumberField(idx, "quantity", e.target.value)} />
                              </td>
                              <td style={td}>
                                <input type="number" min="0" step="0.01" style={inp} value={row.unit_price}
                                  onChange={(e) => updateNumberField(idx, "unit_price", e.target.value)} />
                              </td>
                              <td style={td}>
                                <input type="number" min="0" step="0.01" style={inpRO} value={row.total.toFixed(2)} readOnly />
                              </td>
                              <td style={td}>
                                {row.action === "invoice_only" ? (
                                  <input style={inpRO} value="—" readOnly />
                                ) : (
                                  <input style={inp} value={row.location} placeholder="e.g. R2"
                                    onChange={(e) => updateRow(idx, { location: e.target.value })} />
                                )}
                              </td>
                              <td style={td}>
                                <select
                                  style={{ ...inp, cursor: "pointer" }}
                                  value={row.action}
                                  onChange={(e) => updateAction(idx, e.target.value as ItemAction)}
                                >
                                  <option value="add_stock">Add to Stock</option>
                                  <option value="new_product">New Product</option>
                                  <option value="invoice_only">Invoice Only</option>
                                </select>
                              </td>
                              <td style={td}>
                                {row.action === "add_stock" ? (
                                  linkedProduct ? (
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                      <span style={{ fontSize: 11, color: "#166534", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        → {linkedProduct.product_name}
                                      </span>
                                      <button type="button"
                                        onClick={() => updateRow(idx, { linkedProductId: null, linkQuery: row.product_name })}
                                        style={{ fontSize: 10, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0, whiteSpace: "nowrap" }}>
                                        change
                                      </button>
                                    </div>
                                  ) : (
                                    <div style={{ position: "relative" }}>
                                      <input
                                        style={inp}
                                        value={row.linkQuery}
                                        placeholder="Search existing product…"
                                        onChange={(e) => updateRow(idx, { linkQuery: e.target.value })}
                                      />
                                      {row.linkQuery.trim() && linkMatches.length > 0 && (
                                        <div style={{ position: "absolute", zIndex: 5, top: "calc(100% + 2px)", left: 0, right: 0, border: "1px solid var(--border)", background: "#fff", maxHeight: 160, overflowY: "auto", boxShadow: "0 10px 24px rgba(0,0,0,0.08)" }}>
                                          {linkMatches.map((p) => (
                                            <button
                                              key={p.product_id}
                                              type="button"
                                              onClick={() => updateRow(idx, { linkedProductId: p.product_id, linkQuery: "" })}
                                              style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", fontSize: 11, background: "#fff", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                                            >
                                              {p.product_name}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                      {row.linkQuery.trim() && linkMatches.length === 0 && (
                                        <div style={{ fontSize: 9, color: "#b91c1c", marginTop: 2 }}>No matching product found.</div>
                                      )}
                                    </div>
                                  )
                                ) : row.action === "new_product" ? (
                                  <span style={{ fontSize: 10, color: "#92400e" }}>Fill in details below ↓</span>
                                ) : (
                                  <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
                                )}
                              </td>
                              <td style={td}>
                                {rows.length > 1 && (
                                  <button onClick={() => removeRow(idx)}
                                    style={{ fontSize: 16, color: "#b91c1c", background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>
                                )}
                              </td>
                            </tr>
                            {row.action === "new_product" && (
                              <tr key={`${idx}-details`} style={{ borderBottom: "1px solid var(--border)" }}>
                                <td colSpan={9} style={{ ...td, paddingTop: 0, paddingBottom: 10, background: "#fffbeb" }}>
                                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 10px", border: "1px solid #fde68a", borderTop: "none" }}>
                                    <label style={{
                                      flexShrink: 0, width: 44, height: 44, border: "1px dashed var(--border)", cursor: "pointer",
                                      overflow: "hidden", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff",
                                    }}>
                                      {row.imagePreview ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={row.imagePreview} alt="preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                      ) : (
                                        <span style={{ fontSize: 16, color: "var(--muted)" }}>+</span>
                                      )}
                                      <input
                                        type="file" accept="image/*" style={{ display: "none" }}
                                        onChange={(e) => {
                                          const f = e.target.files?.[0] ?? null;
                                          if (f) {
                                            const reader = new FileReader();
                                            reader.onload = () => {
                                              if (typeof reader.result === "string") {
                                                setCropSrc(reader.result);
                                                setCurrentCropRowIdx(idx);
                                                setShowCropModal(true);
                                              }
                                            };
                                            reader.readAsDataURL(f);
                                          }
                                          e.target.value = "";
                                        }}
                                      />
                                    </label>
                                    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "2fr 3fr", gap: 8 }}>
                                      <div>
                                        <label style={{ ...lbl, color: "#b45309" }}>Category</label>
                                        <select style={{ ...inp, cursor: "pointer" }} value={row.category_id}
                                          onChange={(e) => updateRow(idx, { category_id: e.target.value })}>
                                          <option value="">Category…</option>
                                          {categories.map(c => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
                                        </select>
                                      </div>
                                      <div>
                                        <label style={{ ...lbl, color: "#b45309" }}>Description (optional)</label>
                                        <input style={inp} value={row.description} placeholder="Description (optional)"
                                          onChange={(e) => updateRow(idx, { description: e.target.value })} />
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Items subtotal (reference only — Invoice Total above is what's saved) */}
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Items Subtotal</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--muted)" }}>₹{itemsSubtotal.toFixed(2)}</span>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button onClick={onClose}
                  style={{ padding: "6px 16px", fontSize: 12, border: "1px solid var(--border)", background: "#fff", color: "var(--fg)", cursor: "pointer" }}>
                  Cancel
                </button>
                <button onClick={handleSubmitClick} disabled={isSubmitting || isParsing}
                  style={{ padding: "6px 20px", fontSize: 12, fontWeight: 600, background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer", opacity: isSubmitting || isParsing ? 0.6 : 1 }}>
                  {isSubmitting ? "Saving…" : "Save Invoice"}
                </button>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* Crop modal (new_product rows) */}
      {showCropModal && cropSrc && (
        <ImageCropModal
          imageSrc={cropSrc}
          aspect={1}
          onCrop={(dataUrl, file) => {
            if (currentCropRowIdx !== null) {
              updateRow(currentCropRowIdx, { imageFile: file, imagePreview: dataUrl });
            }
            setShowCropModal(false);
            setCropSrc(null);
            setCurrentCropRowIdx(null);
          }}
          onClose={() => { setShowCropModal(false); setCropSrc(null); setCurrentCropRowIdx(null); }}
        />
      )}

      <style>{`
        @keyframes invoiceParseSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
