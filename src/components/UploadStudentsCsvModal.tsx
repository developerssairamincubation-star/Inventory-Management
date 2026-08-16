"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { authFetch } from "@/contexts/UserContext";
import { decodeStudentIdCode, normalizeStudentIdCode } from "@/lib/studentIdCode";

type DepartmentOption = { department_id: string; department_name: string; code: string | null };

type Props = {
  onClose: () => void;
  onDone: () => void;
  departments: DepartmentOption[];
};

const KNOWN_FIELDS: { key: string; label: string }[] = [
  { key: "student_id_code", label: "Student ID Code" },
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone_number", label: "Phone Number" },
  { key: "ignore", label: "Ignore" },
];

function normalise(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
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
  if (curField !== "" || cur.length > 0) {
    cur.push(curField);
    rows.push(cur);
  }
  if (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === "") rows.pop();
  }
  return rows;
}

type RowPreview = {
  cells: Record<string, string>;
  student_id_code: string;
  name: string;
  email: string;
  phone_number: string;
  departmentName: string | null;
  issue: string | null;
};

export default function UploadStudentsCsvModal({ onClose, onDone, departments }: Props) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<{ ok: number; failed: { row: number; message: string }[] } | null>(null);

  const processGrid = (grid: string[][]) => {
    if (grid.length === 0) {
      setError("File is empty");
      return;
    }
    const h = grid[0].map((hd) => String(hd ?? "").trim());
    setHeaders(h);
    const suggested: Record<number, string> = {};
    h.forEach((hd, idx) => {
      const n = normalise(hd);
      if (/(idcode|studentid|scancode|barcode)/.test(n)) suggested[idx] = "student_id_code";
      else if (/^(name|fullname|studentname)$/.test(n) || /name/.test(n)) suggested[idx] = "name";
      else if (/(email|mail)/.test(n)) suggested[idx] = "email";
      else if (/(phone|mobile|contact)/.test(n)) suggested[idx] = "phone_number";
      else suggested[idx] = "ignore";
    });
    setMapping(suggested);
    const dataRows = grid
      .slice(1)
      .map((r) => {
        const obj: Record<string, string> = {};
        r.forEach((cell, i) => { obj[`c${i}`] = String(cell ?? ""); });
        return obj;
      })
      .filter((r) => Object.values(r).some((v) => v.trim() !== ""));
    setRows(dataRows);
    setResults(null);
  };

  const handleFile = (f: File | null) => {
    setError(null);
    if (!f) return;
    setFileName(f.name);
    const isExcel = /\.(xlsx|xls)$/i.test(f.name);
    if (isExcel) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = new Uint8Array(reader.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: "array" });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
          processGrid(grid);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to parse Excel file");
        }
      };
      reader.readAsArrayBuffer(f);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const grid = parseCSV(String(reader.result || ""));
          processGrid(grid);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to parse CSV");
        }
      };
      reader.readAsText(f);
    }
  };

  const updateCell = (rowIdx: number, colIdx: number, val: string) => {
    setRows((prev) => prev.map((r, i) => (i === rowIdx ? { ...r, [`c${colIdx}`]: val } : r)));
  };

  const mappedValue = (row: Record<string, string>, field: string): string => {
    const colIdx = Object.entries(mapping).find(([, key]) => key === field)?.[0];
    if (colIdx === undefined) return "";
    return (row[`c${colIdx}`] ?? "").trim();
  };

  const buildPreview = (): RowPreview[] => {
    return rows.map((r) => {
      const student_id_code = mappedValue(r, "student_id_code");
      const name = mappedValue(r, "name");
      const email = mappedValue(r, "email");
      const phone_number = mappedValue(r, "phone_number");

      let issue: string | null = null;
      let departmentName: string | null = null;

      if (!student_id_code) {
        issue = "Missing student ID code";
      } else {
        const decoded = decodeStudentIdCode(student_id_code);
        if (!decoded) {
          issue = "Unrecognized ID format";
        } else {
          const dept = departments.find((d) => d.code === decoded.deptCode);
          if (!dept) {
            issue = `Unknown department code "${decoded.deptCode}"`;
          } else {
            departmentName = dept.department_name;
          }
        }
      }

      return { cells: r, student_id_code, name, email, phone_number, departmentName, issue };
    });
  };

  const preview = buildPreview();
  const validCount = preview.filter((p) => !p.issue).length;

  const handleApply = async () => {
    setError(null);
    setApplying(true);
    setResults(null);
    try {
      const valid = preview.filter((p) => !p.issue);
      if (valid.length === 0) {
        setError("No valid rows to upload — fix the flagged issues first");
        return;
      }

      const failed: { row: number; message: string }[] = [];
      let ok = 0;
      for (let i = 0; i < valid.length; i++) {
        const row = valid[i];
        try {
          const res = await authFetch("/api/students", {
            method: "POST",
            body: JSON.stringify({
              student_id_code: normalizeStudentIdCode(row.student_id_code),
              name: row.name || undefined,
              email: row.email || undefined,
              phone_number: row.phone_number || undefined,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            failed.push({ row: i + 1, message: data.error || "Failed to create student" });
          } else {
            ok++;
          }
        } catch (err) {
          failed.push({ row: i + 1, message: err instanceof Error ? err.message : "Request failed" });
        }
      }

      setResults({ ok, failed });
      if (ok > 0) onDone();
    } finally {
      setApplying(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)" }}>
      <div style={{ width: 920, maxHeight: "85vh", overflow: "auto", background: "var(--bg)", padding: 20, border: "1px solid var(--border)", borderRadius: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Bulk Upload Students (CSV / Excel)</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{fileName || "No file selected"}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <label
            className="seg-tab-btn"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0,
              padding: "8px 16px", background: "var(--fg)", color: "#fff",
              border: "1px solid var(--fg)", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            Choose File
            <input type="file" accept=".csv,text/csv,.xlsx,.xls" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} style={{ display: "none" }} />
          </label>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>
            Choose a .csv, .xlsx, or .xls file. First row is treated as headers. Department is resolved from the Student ID Code — not a column.
          </div>
        </div>

        {error && <div style={{ color: "#dc2626", marginBottom: 10, fontSize: 13 }}>{error}</div>}

        {results && (
          <div style={{ marginBottom: 12, fontSize: 13 }}>
            <div style={{ color: "#16a34a", fontWeight: 600 }}>{results.ok} student(s) created</div>
            {results.failed.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ color: "#dc2626", fontWeight: 600 }}>{results.failed.length} failed:</div>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: "#dc2626" }}>
                  {results.failed.map((f) => (
                    <li key={f.row}>Row {f.row}: {f.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {headers.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--text)" }}>Column Mapping</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {headers.map((h, idx) => (
                <div key={idx} style={{ display: "flex", flexDirection: "column", minWidth: 160 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{h}</div>
                  <select
                    value={mapping[idx] ?? "ignore"}
                    onChange={(e) => setMapping((prev) => ({ ...prev, [idx]: e.target.value }))}
                    style={{ padding: "6px 8px", fontSize: 12, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4 }}
                  >
                    {KNOWN_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
              {validCount} of {rows.length} row(s) ready to upload
            </div>
            <div style={{ overflow: "auto", maxHeight: 340, border: "1px solid var(--border)", marginBottom: 14, borderRadius: 6 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--border)" }}>#</th>
                    {headers.map((h, idx) => <th key={idx} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--border)" }}>{h}</th>)}
                    <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--border)" }}>Department</th>
                    <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--border)" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p, ri) => (
                    <tr key={ri} style={{ background: p.issue ? "rgba(239,68,68,0.06)" : undefined }}>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{ri + 1}</td>
                      {headers.map((_, ci) => (
                        <td key={ci} style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
                          <input
                            value={p.cells[`c${ci}`] ?? ""}
                            onChange={(e) => updateCell(ri, ci, e.target.value)}
                            style={{ width: "100%", padding: "6px 8px", fontSize: 12, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4 }}
                          />
                        </td>
                      ))}
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>{p.departmentName || "—"}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
                        {p.issue ? (
                          <span style={{ color: "#dc2626" }}>{p.issue}</span>
                        ) : (
                          <span style={{ color: "#16a34a" }}>Valid</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={{ padding: "8px 16px", border: "1px solid var(--border)", background: "transparent", color: "var(--text)", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>
            Close
          </button>
          <button
            onClick={handleApply}
            disabled={applying || validCount === 0}
            style={{
              padding: "8px 16px",
              background: "var(--fg)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: applying || validCount === 0 ? "not-allowed" : "pointer",
              opacity: applying || validCount === 0 ? 0.6 : 1,
            }}
          >
            {applying ? "Uploading…" : `Upload ${validCount} Student(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
