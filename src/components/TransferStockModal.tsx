"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/contexts/UserContext";
import { extractErrorMessage } from "@/lib/extractErrorMessage";
import { useToast } from "@/components/ui/Toast";

type CoeDomain = {
  domain_id: string;
  domain_name: string;
  room_name: string;
};

export type TransferableProduct = {
  product_id: string;
  product_name: string;
  quantity: number;
  domain_id?: string | null;
  domain_name?: string | null;
};

export type TransferResult = {
  mode: "full" | "partial";
  quantity: number;
  destination_product_id: string;
  destination_domain: { domain_id: string; domain_name: string };
};

const labelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "5px 8px", border: "1px solid var(--border)", fontSize: 12, color: "var(--fg)", boxSizing: "border-box" };

export default function TransferStockModal({
  product,
  onClose,
  onTransferred,
}: {
  product: TransferableProduct;
  onClose: () => void;
  onTransferred: (result: TransferResult) => void;
}) {
  const { showToast } = useToast();
  const [domains, setDomains] = useState<CoeDomain[]>([]);
  const [domainsLoading, setDomainsLoading] = useState(true);
  const [targetDomainId, setTargetDomainId] = useState("");
  const [quantity, setQuantity] = useState<number | "">(product.quantity > 0 ? 1 : "");
  const [location, setLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // The product prop comes from list/detail-page state, which can be stale
  // right after creating a product (that flow patches local state from the
  // create response, which doesn't carry domain_id) — refetch the
  // authoritative current domain/quantity here instead of trusting it.
  const [liveProduct, setLiveProduct] = useState<TransferableProduct>(product);

  useEffect(() => {
    authFetch(`/api/products/${product.product_id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.product) return;
        setLiveProduct({
          product_id: product.product_id,
          product_name: d.product.product_name ?? product.product_name,
          quantity: d.product.stocks?.quantity ?? product.quantity,
          domain_id: d.product.domain_id ?? null,
          domain_name: d.product.domain_name ?? null,
        });
      })
      .catch((err) => console.error("Failed to fetch current product state:", err));
  }, [product.product_id]);

  useEffect(() => {
    authFetch("/api/coe-domains")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setDomains(Array.isArray(d) ? d.filter((dom: CoeDomain) => dom.domain_id !== liveProduct.domain_id) : []))
      .catch((err) => console.error("Failed to fetch COE domains:", err))
      .finally(() => setDomainsLoading(false));
  }, [liveProduct.domain_id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetDomainId) {
      setError("Pick a destination domain");
      return;
    }
    if (quantity === "" || quantity <= 0) {
      setError("Enter a quantity to transfer");
      return;
    }
    if (quantity > liveProduct.quantity) {
      setError(`Only ${liveProduct.quantity} unit(s) available`);
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const res = await authFetch(`/api/products/${product.product_id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_domain_id: targetDomainId,
          quantity,
          ...(location.trim() ? { location: location.trim() } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(extractErrorMessage(body, "Failed to transfer stock"));
      }
      const result = body as TransferResult;
      showToast(`Transferred ${result.quantity} unit(s) to ${result.destination_domain.domain_name}`, "success");
      onTransferred(result);
    } catch (err) {
      console.error("Transfer failed:", err);
      setError(err instanceof Error ? err.message : "Failed to transfer stock");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)" }}>
      <div style={{ background: "#fff", border: "1px solid var(--border)", padding: 24, width: "90%", maxWidth: 420 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>Transfer Stock</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, color: "var(--muted)", cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 18 }}>
          {liveProduct.product_name}
          {liveProduct.domain_name ? <> — currently in <strong>{liveProduct.domain_name}</strong></> : null}
          , {liveProduct.quantity} unit(s) available
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <div style={labelStyle}>Destination Domain</div>
            <select required value={targetDomainId} onChange={(e) => setTargetDomainId(e.target.value)}
              style={{ ...inputStyle, background: "#fff" }} disabled={domainsLoading}>
              <option value="">{domainsLoading ? "Loading…" : "— Select domain —"}</option>
              {domains.map((d) => (
                <option key={d.domain_id} value={d.domain_id}>{d.domain_name} ({d.room_name})</option>
              ))}
            </select>
            {!domainsLoading && domains.length === 0 && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>No other domains to transfer to.</div>
            )}
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ ...labelStyle, marginBottom: 0 }}>Quantity</div>
              <button type="button" onClick={() => setQuantity(liveProduct.quantity)}
                style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                Transfer All ({liveProduct.quantity})
              </button>
            </div>
            <input type="number" required min={1} max={liveProduct.quantity} value={quantity}
              onChange={(e) => setQuantity(e.target.value === "" ? "" : Number(e.target.value))}
              style={inputStyle} />
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={labelStyle}>Destination Location/Rack (optional)</div>
            <input value={location} placeholder="e.g. R2" onChange={(e) => setLocation(e.target.value)} maxLength={50}
              style={inputStyle} />
          </div>

          {error && <div style={{ fontSize: 11, color: "var(--danger, #dc2626)", marginBottom: 12 }}>{error}</div>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
            <button type="button" onClick={onClose}
              style={{ padding: "5px 16px", fontSize: 12, border: "1px solid var(--border)", background: "#fff", color: "var(--fg)", cursor: "pointer" }}>Cancel</button>
            <button type="submit" disabled={submitting || domains.length === 0}
              style={{ padding: "5px 16px", fontSize: 12, fontWeight: 600, background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer", opacity: (submitting || domains.length === 0) ? 0.5 : 1 }}>
              {submitting ? "Transferring…" : "Transfer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
