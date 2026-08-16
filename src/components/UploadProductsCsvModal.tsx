"use client";

import { useEffect, useState } from "react";

type Props = {
  onClose: () => void;
  onApply: (items: ProductItemDraft[]) => void;
  categories: { category_id: string; category_name: string }[];
};

type ProductItemDraft = {
  id: string;
  productName: string;
  description: string;
  quantity: number | "";
  cost: number | "";
  imageFile: File | null;
  imagePreview: string | null;
  category_id: string;
};

// SKUs are auto-generated server-side (category-scoped, printable as a
// barcode) — not a CSV column.
const KNOWN_FIELDS: { key: string; label: string }[] = [
  { key: "product_name", label: "Product Name" },
  { key: "description", label: "Description" },
  { key: "quantity", label: "Quantity" },
  { key: "cost", label: "Cost" },
  { key: "category", label: "Category" },
  { key: "ignore", label: "Ignore" },
];

function normalise(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let curField = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"') {
        if (next === '"') { curField += '"'; i++; } else { inQuotes = false; }
      } else {
        curField += ch;
      }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { cur.push(curField); curField = ""; }
      else if (ch === '\r') continue;
      else if (ch === '\n') { cur.push(curField); rows.push(cur); cur = []; curField = ""; }
      else { curField += ch; }
    }
  }
  // flush
  if (inQuotes) { /* ignore unterminated */ }
  if (curField !== "" || cur.length > 0) {
    cur.push(curField);
    rows.push(cur);
  }
  // remove trailing empty row if file ends with newline
  if (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === "") rows.pop();
  }
  return rows;
}

export default function UploadProductsCsvModal({ onClose, onApply, categories }: Props) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { return () => { /* cleanup if needed */ }; }, []);

  const handleFile = (f: File | null) => {
    setError(null);
    if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      try {
        const parsed = parseCSV(text);
        if (parsed.length === 0) {
          setError("CSV is empty");
          return;
        }
        const h = parsed[0].map(hd => hd.trim());
        setHeaders(h);
        // Suggest mapping
        const suggested: Record<number, string> = {};
        h.forEach((hd, idx) => {
          const n = normalise(hd);
          if (/(name|product)/.test(n)) suggested[idx] = "product_name";
          else if (/(desc)/.test(n)) suggested[idx] = "description";
          else if (/(qty|quantity|stock)/.test(n)) suggested[idx] = "quantity";
          else if (/(cost|price|unit)/.test(n)) suggested[idx] = "cost";
          else if (/(cat|category)/.test(n)) suggested[idx] = "category";
          else suggested[idx] = "ignore";
        });
        setMapping(suggested);
        const dataRows = parsed.slice(1).map(r => {
          const obj: Record<string, string> = {};
          r.forEach((cell, i) => { obj[`c${i}`] = cell; });
          return obj;
        }).filter(r => Object.values(r).some(v => v.trim() !== ""));
        setRows(dataRows);
      } catch (err: any) {
        setError(err?.message || "Failed to parse CSV");
      }
    };
    reader.readAsText(f);
  };

  const updateCell = (rowIdx: number, colIdx: number, val: string) => {
    setRows(prev => prev.map((r, i) => i === rowIdx ? { ...r, [`c${colIdx}`]: val } : r));
  };

  const mapValue = (row: Record<string,string>, colIdx: number) => {
    const key = mapping[colIdx];
    if (!key || key === 'ignore') return undefined;
    const raw = (row[`c${colIdx}`] ?? '').trim();
    if (key === 'category') {
      // try to find category id by name
      if (!raw) return undefined;
      const found = categories.find(c => normalise(c.category_name) === normalise(raw));
      if (found) return found.category_id;
      return isUuid(raw) ? raw : undefined;
    }
    return raw === '' ? undefined : raw;
  };

  const buildProductItems = () => {
    const items: ProductItemDraft[] = rows.map((r, rowIdx) => {
      const draft: ProductItemDraft = {
        id: `csv-${Date.now()}-${rowIdx}`,
        productName: "",
        description: "",
        quantity: "",
        cost: "",
        imageFile: null,
        imagePreview: null,
        category_id: "",
      };

      for (let col = 0; col < headers.length; col++) {
        const key = mapping[col];
        if (!key || key === 'ignore') continue;
        const v = mapValue(r, col);
        if (v === undefined) continue;
        if (key === 'cost') {
          const parsed = Number(String(v).replace(/[^0-9.\-]/g, ''));
          draft.cost = Number.isFinite(parsed) ? parsed : "";
        } else if (key === 'quantity') {
          const parsed = Number(String(v).replace(/[^0-9\-]/g, ''));
          draft.quantity = Number.isFinite(parsed) ? parsed : "";
        } else if (key === 'product_name') {
          draft.productName = String(v);
        } else if (key === 'description') {
          draft.description = String(v);
        } else if (key === 'category') {
          draft.category_id = String(v);
        }
      }

      return draft;
    });

    return items.filter((item) => (
      item.productName ||
      item.description ||
      item.quantity !== "" ||
      item.cost !== "" ||
      item.category_id
    ));
  };

  const handleApply = async () => {
    setError(null);
    setSaving(true);
    try {
      if (rows.length === 0) {
        setError('No rows to apply');
        return;
      }
      const items = buildProductItems();
      if (items.length === 0) {
        setError('No usable data found for the selected mappings');
        return;
      }
      onApply(items);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to apply CSV data');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}>
      <div style={{ width: 920, maxHeight: '85vh', overflow: 'auto', background: '#fff', padding: 18, border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Bulk Upload Products (CSV)</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{fileName || 'No file selected'}</div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <input type="file" accept=".csv,text/csv" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
          </label>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>Choose a CSV file. First row is treated as headers.</div>
        </div>

        {error && <div style={{ color: 'red', marginBottom: 8 }}>{error}</div>}

        {headers.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Column Mapping</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {headers.map((h, idx) => (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', minWidth: 160 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{h}</div>
                  <select value={mapping[idx] ?? 'ignore'} onChange={(e) => setMapping(prev => ({ ...prev, [idx]: e.target.value }))} style={{ padding: '6px 8px', fontSize: 12 }}>
                    {KNOWN_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <div style={{ overflow: 'auto', maxHeight: 360, border: '1px solid var(--border)', marginBottom: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>#</th>
                  {headers.map((h, idx) => <th key={idx} style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri}>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{ri + 1}</td>
                    {headers.map((_, ci) => (
                      <td key={ci} style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
                        <input value={r[`c${ci}`] ?? ''} onChange={(e) => updateCell(ri, ci, e.target.value)} style={{ width: '100%', padding: '6px 8px', fontSize: 12 }} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '6px 12px', border: '1px solid var(--border)', background: '#fff' }}>Cancel</button>
          <button onClick={handleApply} disabled={saving} style={{ padding: '6px 12px', background: 'var(--accent)', color: '#fff', border: 'none' }}>{saving ? 'Applying…' : 'Use Data'}</button>
        </div>
      </div>
    </div>
  );
}
