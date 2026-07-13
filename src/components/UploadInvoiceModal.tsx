"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import ImageCropModal from "@/components/ImageCropModal";
import { useToast } from "@/components/ui/Toast";
import { authFetch } from "@/contexts/UserContext";

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
  serial_number?: string;
  product_code?: string;
};

type NewProductDraft = {
  product_name: string;
  serial_number: string;     // SKU
  unit_cost: number;
  quantity: number;          // initial stock (0 — invoice adds its own qty)
  low_stock_threshold: number;
  type: "consumable" | "returnable" | "both" | "";
  category_id: string;
};

type Decision = {
  index: number;
  action: "add_stock" | "new_product" | "invoice_only";
  existingProductId?: string;
  newProductDraft?: NewProductDraft;
  newProductImageFile?: File | null;
};

type ConfirmItem = {
  index: number;
  parsed: ParsedProduct;
  match: ExistingProduct | null;
};

type ConfirmState = {
  items: ConfirmItem[];
  currentIdx: number;
  decisions: Decision[];
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

function findMatch(name: string, products: ExistingProduct[]): ExistingProduct | null {
  if (!name.trim()) return null;
  const n = normalise(name);
  return (
    products.find((p) => normalise(p.product_name) === n) ??
    products.find((p) => normalise(p.product_name).includes(n) || n.includes(normalise(p.product_name))) ??
    null
  );
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

const emptyProduct = (): ParsedProduct => ({ product_name: "", quantity: 1, unit_price: 0, total: 0 });

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
  const [products,      setProducts]      = useState<ParsedProduct[]>([emptyProduct()]);
  const [autoInvoiceNo, setAutoInvoiceNo] = useState("");
  // ── Categories ─────────────────────────────────────────────────────────────────────────
  const [categories, setCategories] = useState<{category_id: string; category_name: string}[]>([]);
  const [showAddCatModal, setShowAddCatModal] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [addCatLoading, setAddCatLoading] = useState(false);
  // ── Confirmation flow ─────────────────────────────────────────────────────
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [linkExistingEnabled, setLinkExistingEnabled] = useState(false);
  const [linkExistingQuery, setLinkExistingQuery] = useState("");
  const [linkExistingSelection, setLinkExistingSelection] = useState<ExistingProduct | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { showToast } = useToast();

  // ── New product details form (shown when user accepts adding a new product) ─
  const [newProductForm, setNewProductForm] = useState<{
    item: ConfirmItem;
    draft: NewProductDraft;
    imageFile: File | null;
    imagePreview: string | null;
    cropSrc: string | null;
    showCrop: boolean;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch next invoice number on mount ───────────────────────────────────
  useEffect(() => {
    authFetch("/api/invoices/next-number")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.invoice_no) setAutoInvoiceNo(d.invoice_no); })
      .catch(() => {});    // Fetch categories
    authFetch("/api/categories")
      .then((r) => r.ok ? r.json() : [])
      .then((d) => setCategories(Array.isArray(d) ? d : []))
      .catch(() => {});  }, []);

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
          const e = await res.json();
          setParseError(e.error || "Failed to parse PDF");
          return;
        }
        const data = await res.json();
        // Only overwrite a field if the PDF actually returned a value
        if (data.supplier_name)  setSupplierName(data.supplier_name);
        if (data.delivery_date)  setDeliveryDate(data.delivery_date);
        if (data.invoice_number) setInvoiceNumber(data.invoice_number);
        if (data.products?.length > 0) {
          setProducts(
            data.products.map((p: ParsedProduct) => ({
              product_name: p.product_name,
              quantity:     p.quantity,
              unit_price:   p.unit_price,
              total:        p.total,
            }))
          );
        }
      } catch (err: any) {
        setParseError(err.message || "Unexpected error");
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

  // ── Product helpers ────────────────────────────────────────────────────────
  const updateProduct = (idx: number, field: keyof ParsedProduct, val: string | number) => {
    setProducts((prev) => {
      const next = [...prev];
      const p = { ...next[idx], [field]: field === "product_name" ? val : (parseFloat(String(val)) || 0) };
      if (field === "quantity" || field === "unit_price") p.total = p.quantity * p.unit_price;
      next[idx] = p;
      return next;
    });
  };
  const addRow    = () => setProducts((p) => [...p, emptyProduct()]);
  const removeRow = (i: number) => setProducts((p) => p.filter((_, j) => j !== i));
  const grandTotal = products.reduce((s, p) => s + (p.total || 0), 0);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmitClick = () => {
    if (!supplierName.trim())                           { showToast("Please enter a supplier name.", "warning"); return; }
    if (!deliveryDate)                                  { showToast("Please enter a delivery date.", "warning"); return; }
    if (products.length === 0)                          { showToast("Please add at least one product.", "warning"); return; }
    if (products.some((p) => !p.product_name.trim()))  { showToast("All products must have a name.", "warning"); return; }
    const items: ConfirmItem[] = products.map((p, i) => ({ index: i, parsed: p, match: findMatch(p.product_name, existingProducts) }));
    setConfirmState({ items, currentIdx: 0, decisions: [] });
  };

  useEffect(() => {
    setLinkExistingEnabled(false);
    setLinkExistingQuery("");
    setLinkExistingSelection(null);
  }, [confirmState?.currentIdx]);

  // ── Confirmation step ─────────────────────────────────────────────────────
  const handleDecision = (action: "add_stock" | "new_product" | "invoice_only", selectedProduct?: ExistingProduct | null) => {
    if (!confirmState) return;
    const cur = confirmState.items[confirmState.currentIdx];

    // For new_product, pause and show the full new-product details form
    if (action === "new_product") {
      setNewProductForm({
        item: cur,
        draft: {
          product_name: cur.parsed.product_name,
          serial_number: "",
          unit_cost: cur.parsed.unit_price,
          quantity: 0,
          low_stock_threshold: 0,
          type: "",
          category_id: "",
        },
        imageFile: null,
        imagePreview: null,
        cropSrc: null,
        showCrop: false,
      });
      return;
    }

    const newDec: Decision = {
      index: cur.index,
      action,
      existingProductId: action === "add_stock" ? selectedProduct?.product_id ?? cur.match?.product_id : undefined,
    };
    advanceConfirm([...confirmState.decisions, newDec]);
  };

  // Advance to next confirm item or finish
  const advanceConfirm = (decisions: Decision[]) => {
    if (!confirmState) return;
    const nextIdx = confirmState.currentIdx + 1;
    if (nextIdx >= confirmState.items.length) {
      setConfirmState(null);
      executeSubmit(decisions, confirmState.items);
    } else {
      setConfirmState({ ...confirmState, currentIdx: nextIdx, decisions });
    }
  };

  // ── New product form handlers ─────────────────────────────────────────────
  const handleNewProductDone = (draft: NewProductDraft, imageFile: File | null) => {
    if (!confirmState || !newProductForm) return;
    const cur = newProductForm.item;
    const newDec: Decision = { index: cur.index, action: "new_product", newProductDraft: draft, newProductImageFile: imageFile };
    setNewProductForm(null);
    advanceConfirm([...confirmState.decisions, newDec]);
  };

  const handleNewProductSkip = () => {
    if (!confirmState || !newProductForm) return;
    const cur = newProductForm.item;
    const newDec: Decision = { index: cur.index, action: "invoice_only" };
    setNewProductForm(null);
    advanceConfirm([...confirmState.decisions, newDec]);
  };

  const handleCreateCategoryInModal = async () => {
    if (!newCatName.trim() || addCatLoading) return;
    setAddCatLoading(true);
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_name: newCatName.trim() }),
      });
      if (res.ok) {
        const created = await res.json();
        setCategories(prev => [...prev, created]);
        // Auto-select the newly created category in the draft
        setNewProductForm(prev => prev ? { ...prev, draft: { ...prev.draft, category_id: created.category_id } } : prev);
        setNewCatName("");
        setShowAddCatModal(false);
      }
    } catch { /* ignore */ } finally {
      setAddCatLoading(false);
    }
  };

  const executeSubmit = async (decisions: ConfirmState["decisions"], items: ConfirmItem[]) => {
    setIsSubmitting(true);
    try {
      const productIdMap: Record<number, string> = {};
      for (const dec of decisions) {
        const item = items[dec.index];
        if (dec.action === "add_stock" && dec.existingProductId) {
          productIdMap[dec.index] = dec.existingProductId;
        } else if (dec.action === "new_product" && dec.newProductDraft) {
          const d = dec.newProductDraft;
          // Upload image first if provided
          let image_url: string | undefined;
          if (dec.newProductImageFile) {
            const fd = new FormData();
            fd.append("file", dec.newProductImageFile);
            fd.append("folder", "products");
              const uploadRes = await authFetch("/api/upload", { method: "POST", body: fd });
            if (uploadRes.ok) {
              const uploadData = await uploadRes.json();
              image_url = uploadData.url;
            }
          }
          const body: Record<string, unknown> = {
            product_name: d.product_name,
            unit_cost: d.unit_cost,
            quantity: d.quantity,
            serial_number: d.serial_number || undefined,
            low_stock_threshold: d.low_stock_threshold || undefined,
            ...(image_url ? { image_url } : {}),
          };
          if (d.type === "consumable") { body.consumable = true; body.returnable = false; }
          else if (d.type === "returnable") { body.consumable = false; body.returnable = true; }
          else if (d.type === "both") { body.consumable = true; body.returnable = true; }
          if (d.category_id) body.category_id = d.category_id;
          const res = await authFetch("/api/products", { method: "POST", body: JSON.stringify(body) });
          if (!res.ok) {
            const e = await res.json();
            throw new Error(`Failed to create "${d.product_name}": ${e.error}`);
          }
          const newProd = await res.json();
          productIdMap[dec.index] = newProd.product?.product_id ?? newProd.product_id;
        }
      }

      const invoiceItems = decisions.map((d) => {
        const p = items[d.index].parsed;
        return {
          product_id: productIdMap[d.index] ?? null,
          product_name: p.product_name,
          quantity: p.quantity,
          unit_cost: p.unit_price,
          total_cost: p.total,
        };
      });

      if (invoiceItems.length === 0) {
        showToast("Please add at least one invoice item.", "warning");
        setIsSubmitting(false);
        return;
      }

      const invNo = invoiceNumber.trim() || autoInvoiceNo;
      const res = await authFetch("/api/invoices", { method: "POST", body: JSON.stringify({ invoice_number: invNo, supplier_name: supplierName, received_date: deliveryDate, items: invoiceItems }) });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || "Failed to create invoice");
      }
      showToast("Invoice created successfully! Stock was updated for linked products.", "success");
      onSuccess();
      onClose();
    } catch (err: any) {
      showToast(`Error: ${err.message}`, "error");    } finally {
      setIsSubmitting(false);
    }
  };

  // ── New Product Details screen ────────────────────────────────────────────
  if (newProductForm) {
    const { item, draft, imageFile, imagePreview, cropSrc, showCrop } = newProductForm;
    const progress = confirmState
      ? `${confirmState.currentIdx + 1} / ${confirmState.items.length}`
      : "1 / 1";

    const setDraft = (patch: Partial<NewProductDraft>) =>
      setNewProductForm((prev) => prev ? { ...prev, draft: { ...prev.draft, ...patch } } : prev);
    const setImg = (patch: Partial<{ imageFile: File | null; imagePreview: string | null; cropSrc: string | null; showCrop: boolean }>) =>
      setNewProductForm((prev) => prev ? { ...prev, ...patch } : prev);

    const canSave = draft.product_name.trim() !== "" && draft.unit_cost >= 0 && draft.type !== "";

    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)" }}>
        <div style={{ background: "#fff", width: "100%", maxWidth: 700, padding: 28, display: "flex", flexDirection: "column", gap: 18, boxShadow: "0 8px 32px rgba(0,0,0,.18)", maxHeight: "90vh", overflowY: "auto" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fg)" }}>Add New Product</div>
            <div style={{ fontSize: 10, color: "var(--muted)", background: "var(--surface, #f1f5f9)", padding: "2px 8px" }}>{progress}</div>
          </div>

          {/* Invoice reference */}
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 4, padding: "10px 14px", fontSize: 11, color: "#92400e" }}>
            <strong>From invoice:</strong>&nbsp; {item.parsed.product_name}
            &nbsp;·&nbsp; Invoice Qty: <strong>{item.parsed.quantity}</strong>
            &nbsp;·&nbsp; Unit: <strong>₹{item.parsed.unit_price.toFixed(2)}</strong>
          </div>

          {/* Form table — matches the Add New Products layout */}
          <div>
            {/* Column headers */}
            <div style={{ display: "grid", gridTemplateColumns: "3fr 1.5fr 80px 90px 80px 110px 130px", gap: 8, marginBottom: 6 }}>
              {["PRODUCT NAME", "SKU", "QTY", "COST", "THRESHOLD", "TYPE", "CATEGORY"].map((h) => (
                <div key={h} style={{ fontSize: 9, fontWeight: 700, color: "#b45309", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</div>
              ))}
            </div>

            {/* Single data row */}
            <div style={{ display: "grid", gridTemplateColumns: "3fr 1.5fr 80px 90px 80px 110px 130px", gap: 8, alignItems: "center" }}>
              <input style={inp} value={draft.product_name} placeholder="Product name"
                onChange={(e) => setDraft({ product_name: e.target.value })} />
              <input style={inp} value={draft.serial_number} placeholder="SKU"
                onChange={(e) => setDraft({ serial_number: e.target.value })} />
              <input type="number" min="0" style={inp} value={draft.quantity}
                onChange={(e) => setDraft({ quantity: parseFloat(e.target.value) || 0 })} />
              <input type="number" min="0" step="0.01" style={inp} value={draft.unit_cost}
                onChange={(e) => setDraft({ unit_cost: parseFloat(e.target.value) || 0 })} />
              <input type="number" min="0" style={inp} value={draft.low_stock_threshold}
                onChange={(e) => setDraft({ low_stock_threshold: parseInt(e.target.value) || 0 })} />
              <select style={{ ...inp, cursor: "pointer" }} value={draft.type}
                onChange={(e) => setDraft({ type: e.target.value as NewProductDraft["type"] })}>
                <option value="">Select</option>
                <option value="consumable">Consumable</option>
                <option value="returnable">Returnable</option>
                <option value="both">Both</option>
              </select>
              <select style={{ ...inp, cursor: "pointer" }} value={draft.category_id}
                onChange={(e) => {
                  if (e.target.value === "__add_new__") { setShowAddCatModal(true); }
                  else { setDraft({ category_id: e.target.value }); }
                }}>
                <option value="">Category…</option>
                {categories.map(c => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
                <option value="__add_new__">╋ Add New Category</option>
              </select>
            </div>

            {/* Field notes */}
            <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 6, lineHeight: 1.6 }}>
              <strong>QTY</strong> = initial stock when product is created.&nbsp;
              Invoice quantity ({item.parsed.quantity}) will be added automatically.
            </div>
          </div>

          {/* Image upload */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
              Product Photo <span style={{ fontWeight: 400, color: "var(--muted)", textTransform: "none", letterSpacing: 0 }}>(optional)</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {/* Preview */}
              {imagePreview ? (
                <div style={{ flexShrink: 0, width: 80, height: 80, border: "1px solid var(--border)", overflow: "hidden", background: "var(--surface, #f8f9fa)" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imagePreview} alt="preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
              ) : (
                <div style={{ flexShrink: 0, width: 80, height: 80, border: "1px dashed var(--border)", background: "var(--surface, #f8f9fa)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 22, opacity: 0.3 }}>📷</span>
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--fg)", cursor: "pointer", padding: "5px 12px", border: "1px solid var(--border)", background: "var(--surface, #f8f9fa)", whiteSpace: "nowrap" }}>
                  {imagePreview ? "Replace Photo" : "Upload & Crop Photo"}
                  <input type="file" accept="image/*" style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      if (f) {
                        const reader = new FileReader();
                        reader.onload = () => {
                          if (typeof reader.result === "string") {
                            setImg({ cropSrc: reader.result, showCrop: true });
                          }
                        };
                        reader.readAsDataURL(f);
                      }
                      e.target.value = "";
                    }}
                  />
                </label>
                {imagePreview && (
                  <button type="button" onClick={() => setImg({ imageFile: null, imagePreview: null })}
                    style={{ fontSize: 11, color: "#b91c1c", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
                    Remove photo
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Crop modal */}
          {showCrop && cropSrc && (
            <ImageCropModal
              imageSrc={cropSrc}
              aspect={1}
              onCrop={(dataUrl, file) => {
                setImg({ imageFile: file, imagePreview: dataUrl, cropSrc: null, showCrop: false });
              }}
              onClose={() => setImg({ cropSrc: null, showCrop: false })}
            />
          )}

          {/* Add Category Mini Modal */}
          {showAddCatModal && (
            <div style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)" }}>
              <div style={{ background: "#fff", border: "1px solid var(--border)", padding: 20, width: 320, boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Add New Category</div>
                <input
                  autoFocus
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleCreateCategoryInModal()}
                  placeholder="Category name…"
                  style={{ width: "100%", padding: "6px 8px", fontSize: 12, border: "1px solid var(--border)", color: "var(--fg)", boxSizing: "border-box", marginBottom: 14, outline: "none" }}
                />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={() => { setShowAddCatModal(false); setNewCatName(""); }}
                    style={{ padding: "5px 14px", fontSize: 12, border: "1px solid var(--border)", background: "#fff", color: "var(--fg)", cursor: "pointer" }}>Cancel</button>
                  <button onClick={handleCreateCategoryInModal} disabled={!newCatName.trim() || addCatLoading}
                    style={{ padding: "5px 14px", fontSize: 12, background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600, opacity: !newCatName.trim() || addCatLoading ? 0.5 : 1 }}>
                    {addCatLoading ? "Adding…" : "Add Category"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Validation hint */}
          {!canSave && (
            <div style={{ fontSize: 11, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", padding: "6px 12px" }}>
              Please fill in Product Name, Cost and Type before saving.
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={handleNewProductSkip}
              style={{ padding: "6px 14px", fontSize: 12, border: "1px solid var(--border)", background: "#fff", color: "var(--muted)", cursor: "pointer" }}>
              Invoice Only
            </button>
            <button onClick={() => canSave && handleNewProductDone(draft, imageFile)} disabled={!canSave}
              style={{ padding: "6px 20px", fontSize: 12, fontWeight: 600, background: "var(--accent)", color: "#fff", border: "none", cursor: canSave ? "pointer" : "not-allowed", opacity: canSave ? 1 : 0.5 }}>
              Add Product ✓
            </button>
          </div>

        </div>
      </div>
    );
  }

  // ── Confirmation dialog ───────────────────────────────────────────────────
  if (confirmState) {
    const cur      = confirmState.items[confirmState.currentIdx];
    const isExist  = cur.match !== null;
    const progress = `${confirmState.currentIdx + 1} / ${confirmState.items.length}`;
    const existingMatches = searchProducts(linkExistingQuery, existingProducts)
      .filter((product) => product.product_id !== linkExistingSelection?.product_id);

    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)" }}>
        <div style={{ background: "#fff", width: "100%", maxWidth: 460, padding: 28, display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 8px 32px rgba(0,0,0,.18)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fg)" }}>
              {isExist ? "Product Already Exists" : "New Product Detected"}
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)", background: "var(--surface, #f1f5f9)", padding: "2px 8px" }}>{progress}</div>
          </div>
          <div style={{ background: "var(--surface, #f8f9fa)", border: "1px solid var(--border)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>{cur.parsed.product_name}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              Qty: <strong>{cur.parsed.quantity}</strong> &nbsp;·&nbsp; Unit: <strong>₹{cur.parsed.unit_price.toFixed(2)}</strong> &nbsp;·&nbsp; Total: <strong>₹{cur.parsed.total.toFixed(2)}</strong>
            </div>
          </div>
          {isExist ? (
            <>
              <div style={{ fontSize: 12, color: "var(--fg)" }}>A matching product was found in your catalog:</div>
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "10px 14px", fontSize: 12, color: "#166534", fontWeight: 500 }}>
                {cur.match!.product_name} &nbsp;—&nbsp; ₹{cur.match!.unit_cost.toFixed(2)}
              </div>
              <div style={{ fontSize: 12, color: "var(--fg)" }}>Add <strong>{cur.parsed.quantity} units</strong> to existing stock?</div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => handleDecision("invoice_only")}
                  style={{ padding: "5px 12px", fontSize: 12, border: "1px solid var(--border)", background: "#fff", color: "var(--muted)", cursor: "pointer" }}>Invoice Only</button>
                <button onClick={() => handleDecision("new_product")}
                  style={{ padding: "5px 12px", fontSize: 12, border: "1px solid #d97706", background: "#fffbeb", color: "#b45309", cursor: "pointer", fontWeight: 500 }}>Add as New Product</button>
                <button onClick={() => handleDecision("add_stock")}
                  style={{ padding: "5px 14px", fontSize: 12, border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer", fontWeight: 600 }}>Add to Stock ✓</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "var(--fg)" }}>This product is not in your catalog. You can add it as a new product, or link it to an existing product and update that stock.</div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--fg)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={linkExistingEnabled}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setLinkExistingEnabled(checked);
                    setLinkExistingSelection(null);
                    setLinkExistingQuery(checked ? cur.parsed.product_name : "");
                  }}
                />
                Add as existing product
              </label>
              {linkExistingEnabled && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ position: "relative" }}>
                    <input
                      autoFocus
                      style={inp}
                      value={linkExistingQuery}
                      placeholder="Type to search products"
                      onChange={(e) => {
                        setLinkExistingQuery(e.target.value);
                        setLinkExistingSelection(null);
                      }}
                    />
                    {linkExistingQuery.trim() && existingMatches.length > 0 && !linkExistingSelection && (
                      <div style={{ position: "absolute", zIndex: 2, top: "calc(100% + 4px)", left: 0, right: 0, border: "1px solid var(--border)", background: "#fff", maxHeight: 180, overflowY: "auto", boxShadow: "0 10px 24px rgba(0,0,0,0.08)" }}>
                        {existingMatches.map((product) => (
                          <button
                            key={product.product_id}
                            type="button"
                            onClick={() => {
                              setLinkExistingSelection(product);
                              setLinkExistingQuery(product.product_name);
                            }}
                            style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", background: "#fff", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                          >
                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--fg)" }}>{product.product_name}</div>
                            <div style={{ fontSize: 10, color: "var(--muted)" }}>₹{product.unit_cost.toFixed(2)}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {linkExistingSelection ? (
                    <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", padding: "10px 12px", fontSize: 12, color: "#1d4ed8" }}>
                      Selected existing product: <strong>{linkExistingSelection.product_name}</strong>
                    </div>
                  ) : linkExistingQuery.trim() ? (
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>No matching products selected yet.</div>
                  ) : null}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => handleDecision("invoice_only")}
                  style={{ padding: "5px 12px", fontSize: 12, border: "1px solid var(--border)", background: "#fff", color: "var(--muted)", cursor: "pointer" }}>Invoice Only</button>
                <button onClick={() => handleDecision("new_product")}
                  style={{ padding: "5px 14px", fontSize: 12, border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer", fontWeight: 600 }}>Add New Product ✓</button>
                {linkExistingEnabled && (
                  <button
                    onClick={() => linkExistingSelection && handleDecision("add_stock", linkExistingSelection)}
                    disabled={!linkExistingSelection}
                    style={{ padding: "5px 14px", fontSize: 12, border: "1px solid #1d4ed8", background: linkExistingSelection ? "#eff6ff" : "#dbeafe", color: "#1d4ed8", cursor: linkExistingSelection ? "pointer" : "not-allowed", fontWeight: 600, opacity: linkExistingSelection ? 1 : 0.6 }}
                  >
                    Add to Existing Stock
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Main screen ───────────────────────────────────────────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "stretch", justifyContent: "center" }}>
      <div style={{ background: "#fff", width: "100%", maxWidth: 1200, margin: 16, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,.22)" }}>

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
          <div style={{ width: "45%", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", minHeight: 0 }}>
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
                  {isParsing && <span style={{ fontSize: 10, color: "var(--accent)", whiteSpace: "nowrap" }}>Parsing…</span>}
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

              {/* Invoice meta */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  Invoice Details
                  {isParsing && <span style={{ fontWeight: 400, color: "var(--accent)", textTransform: "none", letterSpacing: 0 }}>⏳ Auto-filling from PDF…</span>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={{ gridColumn: "1/-1" }}>
                    <label style={lbl}>Supplier / Merchant Name *</label>
                    <input style={inp} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="e.g. ABC Distributors" />
                  </div>
                  <div>
                    <label style={lbl}>Delivery Date *</label>
                    <input type="date" style={inp} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
                  </div>
                  <div>
                    <label style={lbl}>Invoice Number</label>
                    <input style={inp} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder={autoInvoiceNo || "e.g. INV-001"} />
                  </div>
                </div>
              </div>

              {/* Products */}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Products &amp; Items</div>
                  <button onClick={addRow} style={{ fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}>+ Add row</button>
                </div>
                {/* Column headers */}
                <div style={{ display: "grid", gridTemplateColumns: "3fr 70px 90px 90px 24px", gap: 4, marginBottom: 4 }}>
                  {["Product Name", "Qty", "Unit Cost", "Total", ""].map((h) => (
                    <div key={h} style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</div>
                  ))}
                </div>
                {/* Rows */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {products.map((p, idx) => {
                    const match = findMatch(p.product_name, existingProducts);
                    return (
                      <div key={idx}>
                        <div style={{ display: "grid", gridTemplateColumns: "3fr 70px 90px 90px 24px", gap: 4, alignItems: "center" }}>
                          <input style={inp} value={p.product_name} placeholder="Product name"
                            onChange={(e) => updateProduct(idx, "product_name", e.target.value)} />
                          <input type="number" min="0" style={inp} value={p.quantity}
                            onChange={(e) => updateProduct(idx, "quantity", e.target.value)} />
                          <input type="number" min="0" step="0.01" style={inp} value={p.unit_price}
                            onChange={(e) => updateProduct(idx, "unit_price", e.target.value)} />
                          <input type="number" min="0" step="0.01" style={inpRO} value={p.total.toFixed(2)} readOnly />
                          <button onClick={() => removeRow(idx)} disabled={products.length === 1}
                            style={{ fontSize: 16, color: products.length === 1 ? "#ccc" : "#b91c1c", background: "none", border: "none", cursor: products.length === 1 ? "not-allowed" : "pointer", padding: 0, lineHeight: 1 }}>×</button>
                        </div>
                        {p.product_name.trim() && (
                          <div style={{ fontSize: 9, marginTop: 3, marginLeft: 2, color: match ? "#166534" : "#92400e" }}>
                            {match ? `✓ Matches existing: ${match.product_name}` : "⚠ New product detected — review can add it to catalog or link it to an existing product"}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Grand total */}
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Grand Total</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: "var(--fg)" }}>₹{grandTotal.toFixed(2)}</span>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button onClick={onClose}
                  style={{ padding: "6px 16px", fontSize: 12, border: "1px solid var(--border)", background: "#fff", color: "var(--fg)", cursor: "pointer" }}>
                  Cancel
                </button>
                <button onClick={handleSubmitClick} disabled={isSubmitting || isParsing}
                  style={{ padding: "6px 20px", fontSize: 12, fontWeight: 600, background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer", opacity: isSubmitting || isParsing ? 0.6 : 1 }}>
                  {isSubmitting ? "Saving…" : "Review & Save"}
                </button>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
