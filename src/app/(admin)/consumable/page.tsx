"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/contexts/UserContext";
import { usePagination } from "@/hooks/usePagination";
import Pagination from "@/components/Pagination";
import { ArrowUpNarrowWide, ArrowUpWideNarrow } from "lucide-react";
import { groupByStudentAndDate } from "@/lib/groupLendingRecords";
import { presetRange, inDateRange, type DatePreset } from "@/lib/dateRangePresets";

// Lending-activity log of items handed out under consumable terms
// (lending_item.item_type === 'CONSUMABLE') — contrast with Returnable,
// which is a product-catalog view rather than a transaction log.
interface ConsumableRecord {
  id: number;
  borrower_name: string;
  student_id_code: string | null;
  department: string;
  department_code: string | null;
  domain_name: string;
  room_name: string;
  product_name: string;
  item_type: string | null;
  quantity: number;
  lending_date: string;
  status: string;
}

const formatDate = (dateString: string | null): string => {
  if (!dateString) return "—";
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

type SortCol = "lending_date" | "quantity" | null;
type SortDir = "asc" | "desc";

const selectStyle: React.CSSProperties = {
  fontSize: 13,
  border: "1px solid var(--border)",
  padding: "8px 12px",
  color: "var(--fg)",
  background: "var(--bg)",
  outline: "none",
  cursor: "pointer",
  minWidth: 130,
};

const th: React.CSSProperties = {
  padding: "6px 10px",
  textAlign: "left",
  fontSize: 12,
  fontWeight: 600,
  color: "#0E1323",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  border: "1px solid #d1d1d1",
  whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "7px 10px",
  fontSize: 12,
  color: "var(--fg)",
  border: "1px solid #d1d1d1",
};

export default function ConsumablePage() {
  const [records, setRecords] = useState<ConsumableRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch("/api/lending?period=yearly");
        if (res.ok) {
          const data = await res.json();
          const all: ConsumableRecord[] = data.records || [];
          setRecords(all.filter((r) => r.item_type === "CONSUMABLE"));
        }
      } catch (error) {
        console.error("Error fetching lending records:", error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const uniqueDepartments = Array.from(
    records.reduce((map, r) => {
      if (r.department && r.department !== "—" && !map.has(r.department)) map.set(r.department, r.department_code ?? null);
      return map;
    }, new Map<string, string | null>())
  ).map(([name, code]) => ({ name, code }));
  const uniqueProducts = Array.from(new Set(records.map((r) => r.product_name).filter(Boolean)));

  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  };

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sortCol !== col) return <ArrowUpNarrowWide size={11} style={{ opacity: 0.3, flexShrink: 0 }} />;
    return sortDir === "asc"
      ? <ArrowUpNarrowWide size={11} style={{ flexShrink: 0, color: "var(--accent)" }} />
      : <ArrowUpWideNarrow size={11} style={{ flexShrink: 0, color: "var(--accent)" }} />;
  };

  const filtered = records
    .filter((r) =>
      !searchQuery ||
      r.borrower_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.student_id_code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.product_name?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .filter((r) => !deptFilter || r.department === deptFilter)
    .filter((r) => !productFilter || r.product_name === productFilter)
    .filter((r) => inDateRange(r.lending_date, dateFrom, dateTo));

  // Two lending_order rows for the same student on the same day (a split
  // multi-item submission, or a re-scanned entry) read as one row here —
  // see groupByStudentAndDate for why grouping is date-local, not UTC.
  const groups = groupByStudentAndDate(filtered);

  let sortedGroups = groups;
  if (sortCol === "quantity") {
    sortedGroups = [...groups].sort((a, b) => {
      const av = a.records.reduce((s, r) => s + r.quantity, 0);
      const bv = b.records.reduce((s, r) => s + r.quantity, 0);
      return sortDir === "asc" ? av - bv : bv - av;
    });
  } else {
    const dir = sortCol === "lending_date" ? sortDir : "desc";
    sortedGroups = [...groups].sort((a, b) => {
      const av = new Date(a.date).getTime();
      const bv = new Date(b.date).getTime();
      return dir === "asc" ? av - bv : bv - av;
    });
  }

  const { page, setPage, totalPages, padRows, showAll, setShowAll, startIdx, endIdx, total } = usePagination(sortedGroups, { pageSize: 50 });

  const applyDatePreset = (preset: DatePreset) => {
    const { from, to } = presetRange(preset);
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
  };

  if (loading) return <div style={{ padding: 20, fontSize: 12, color: "var(--muted)" }}>Loading consumable records…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg)" }}>Consumable</div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Items lent out under consumable terms</div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <select value={deptFilter} onChange={(e) => { setDeptFilter(e.target.value); setPage(1); }} style={selectStyle} className="dropdown-control">
          <option value="">All Departments</option>
          {uniqueDepartments.map((d) => <option key={d.name} value={d.name}>{d.code || d.name}</option>)}
        </select>
        <select value={productFilter} onChange={(e) => { setProductFilter(e.target.value); setPage(1); }} style={selectStyle} className="dropdown-control">
          <option value="">All Products</option>
          {uniqueProducts.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input
          placeholder="Search by name, student ID, product…"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          style={{ flex: 1, minWidth: 180, padding: "5px 10px", fontSize: 12, border: "1px solid var(--border)", color: "var(--fg)", background: "var(--bg)", outline: "none" }}
        />
        {(deptFilter || productFilter || searchQuery || dateFrom || dateTo) && (
          <button
            onClick={() => { setDeptFilter(""); setProductFilter(""); setSearchQuery(""); setDateFrom(""); setDateTo(""); setPage(1); }}
            style={{ padding: "5px 10px", fontSize: 11, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--muted)", cursor: "pointer" }}
          >Clear</button>
        )}
      </div>

      {/* Date range filter */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <label style={{ fontSize: 11, color: "var(--muted)" }}>From</label>
        <input
          type="date"
          value={dateFrom}
          max={dateTo || undefined}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          className="dropdown-control"
          style={{ padding: "7px 10px", fontSize: 12, border: "1px solid var(--border)", color: "var(--fg)", background: "var(--bg)", outline: "none" }}
        />
        <label style={{ fontSize: 11, color: "var(--muted)" }}>To</label>
        <input
          type="date"
          value={dateTo}
          min={dateFrom || undefined}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          className="dropdown-control"
          style={{ padding: "7px 10px", fontSize: 12, border: "1px solid var(--border)", color: "var(--fg)", background: "var(--bg)", outline: "none" }}
        />
        <div style={{ width: 1, height: 20, background: "var(--border)", margin: "0 2px" }} />
        <button onClick={() => applyDatePreset("thisMonth")} className="seg-tab-btn" style={{ background: "var(--surface)", color: "var(--fg)" }}>This Month</button>
        <button onClick={() => applyDatePreset("lastMonth")} className="seg-tab-btn" style={{ background: "var(--surface)", color: "var(--fg)" }}>Last Month</button>
        <button onClick={() => applyDatePreset("thisYear")} className="seg-tab-btn" style={{ background: "var(--surface)", color: "var(--fg)" }}>This Year</button>
      </div>

      <div style={{ background: "#fff", border: "1px solid var(--border)", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ overflowX: "auto", overflowY: "auto", flex: 1, minHeight: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--surface)" }}>
              <tr>
                <th style={{ ...th, width: 40 }}>S.No</th>
                <th style={th}>Student</th>
                <th style={th}>Student ID</th>
                <th style={th}>Dept</th>
                <th style={th}>Domain/Room</th>
                <th style={th}>Product</th>
                <th onClick={() => handleSort("quantity")} style={{ ...th, width: 70, cursor: "pointer" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>Qty <SortIcon col="quantity" /></span>
                </th>
                <th onClick={() => handleSort("lending_date")} style={{ ...th, cursor: "pointer" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>Date <SortIcon col="lending_date" /></span>
                </th>
              </tr>
            </thead>
            <tbody>
              {padRows.map((group, idx) => (
                <tr key={group ? group.key : `empty-${idx}`}>
                  {group ? (
                    <>
                      <td style={td}>{startIdx + idx + 1}</td>
                      <td style={{ ...td, fontWeight: 500 }}>{group.records[0].borrower_name || "—"}</td>
                      <td style={{ ...td, fontFamily: "monospace" }}>{group.records[0].student_id_code || "—"}</td>
                      <td style={td}>{group.records[0].department_code || group.records[0].department || "—"}</td>
                      <td style={td}>{group.records[0].domain_name}{group.records[0].room_name !== "—" ? ` / ${group.records[0].room_name}` : ""}</td>
                      <td style={{ ...td, maxWidth: 220 }}>
                        <div style={{ overflowX: "auto", whiteSpace: "nowrap" }} title={group.records.map((r) => `${r.product_name} (${r.quantity})`).join(", ")}>
                          {group.records.map((r) => r.product_name).filter(Boolean).join(", ") || "—"}
                        </div>
                      </td>
                      <td style={td}>{group.records.reduce((s, r) => s + r.quantity, 0)}</td>
                      <td style={td}>{formatDate(group.date)}</td>
                    </>
                  ) : (
                    <td style={{ ...td, border: "none" }} colSpan={8}>&nbsp;</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", background: "var(--surface)", padding: "8px 12px", borderTop: "1px solid var(--border)" }}>
          <span>{total > 0 ? `Showing ${showAll ? total : Math.min(startIdx + 1, total)}–${showAll ? total : Math.min(endIdx, total)} of ${total}` : "No consumable records found"}</span>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} showAll={showAll} onToggleShowAll={setShowAll} />
        </div>
      </div>
    </div>
  );
}
