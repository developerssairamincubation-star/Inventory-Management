"use client";

import { Fragment, useEffect, useState } from "react";
import { authFetch } from "@/contexts/UserContext";
import { useToast } from "@/components/ui/Toast";
import { usePagination } from "@/hooks/usePagination";
import Pagination from "@/components/Pagination";
import { ArrowUpNarrowWide, ArrowUpWideNarrow } from "lucide-react";
import { groupByStudentAndDate, computeItemCounts } from "@/lib/groupLendingRecords";
import { presetRange, inDateRange, type DatePreset } from "@/lib/dateRangePresets";

// Where a returnable item actually gets marked returned/damaged/lost. This
// used to be a read-only product catalog (returnable=true products), which
// had no way to record a return at all — the real return workflow lived
// entirely on the Entry (lending) page. This page now shows the same
// lending-history data, filtered to RETURNABLE items, with the identical
// return/damage/lost mechanics ported from Entry — same API calls, same
// order-level status computation, just scoped to a focused "handle returns"
// screen instead of buried in the full lending table.
const formatDate = (dateString: string | null): string => {
  if (!dateString) return "—";
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

type SortCol = "lending_date" | "due_date" | "return_date" | "original_quantity" | null;
type SortDir = "asc" | "desc";

// A record is still "open" (something outstanding to mark) while its status
// is one of these — anything else (RETURNED / RETURNED_DAMAGED /
// RETURNED_LOST / DAMAGED / LOST) is a closed, terminal state. Drives both
// the status-filter dropdown and the Pending Return / Returned tab split.
const PENDING_STATUSES = ["PENDING", "PARTIALLY_RETURNED", "PARTIALLY_DAMAGED", "PARTIALLY_LOST"];

// Coarser grouping than the raw status column — a status filter of "Damaged"
// should also catch PARTIALLY_DAMAGED, not just the fully-damaged terminal
// state (mirrors the same grouping used on the full Entry/lending table).
function matchesStatusFilter(status: string, filter: string): boolean {
  if (!filter) return true;
  const s = status?.toUpperCase() ?? "";
  if (filter === "RETURNED") return ["RETURNED", "RETURNED_DAMAGED", "RETURNED_LOST"].includes(s);
  if (filter === "DAMAGED") return ["DAMAGED", "PARTIALLY_DAMAGED", "RETURNED_DAMAGED"].includes(s);
  if (filter === "LOST") return ["LOST", "PARTIALLY_LOST", "RETURNED_LOST"].includes(s);
  if (filter === "PENDING") return PENDING_STATUSES.includes(s);
  return true;
}


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

// The Status column is pinned to the end of the row so it stays reachable
// while the table scrolls horizontally — keep this in sync with the
// sticky th/td `width`/`right` below.
const STATUS_COL_WIDTH = 160;

type LendingRecord = {
  id: number;
  borrower_name: string;
  student_id_code: string | null;
  department: string;
  department_code: string | null;
  domain_name: string;
  room_name: string;
  product_name: string;
  product_id: string | null;
  item_type: "RETURNABLE" | "CONSUMABLE" | null;
  original_quantity: number;
  quantity: number;
  damaged_quantity: number;
  lost_quantity: number;
  lending_date: string;
  due_date: string;
  return_date: string | null;
  status: string;
};

const th: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 10,
  fontWeight: 600,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  border: "1px solid #E5E7EB",
  textAlign: "left",
  whiteSpace: "nowrap",
  userSelect: "none",
};
const td: React.CSSProperties = { padding: "7px 10px", fontSize: 12, color: "var(--fg)", border: "1px solid #E5E7EB" };

export default function ReturnablePage() {
  const [records, setRecords] = useState<LendingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  // Pending Return vs Returned — splits the table into two toggleable
  // sections instead of one long list mixing open and closed items.
  const [activeTab, setActiveTab] = useState<"pending" | "returned">("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const { showToast } = useToast();

  const [damagedRowIdx, setDamagedRowIdx] = useState<number | null>(null);
  const [damagedQtyStr, setDamagedQtyStr] = useState("1");
  const [damageLoading, setDamageLoading] = useState(false);

  const [lostRowIdx, setLostRowIdx] = useState<number | null>(null);
  const [lostQtyStr, setLostQtyStr] = useState("1");
  const [lostLoading, setLostLoading] = useState(false);

  const [returnPickerRowIdx, setReturnPickerRowIdx] = useState<number | null>(null);
  const [returnPickerDate, setReturnPickerDate] = useState("");
  const [returnPickerQty, setReturnPickerQty] = useState(1);
  const [returnPickerLoading, setReturnPickerLoading] = useState(false);

  // Which multi-item (student, date) groups are expanded to show their
  // individual item rows — see groupByStudentAndDate.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchRecords();
  }, []);

  async function fetchRecords() {
    try {
      setLoading(true);
      const res = await authFetch("/api/lending?period=yearly");
      if (res.ok) {
        const data = await res.json();
        setRecords(data.records || []);
      }
    } catch (error) {
      console.error("Error fetching lending records:", error);
    } finally {
      setLoading(false);
    }
  }

  const handleMarkDamaged = async (record: LendingRecord) => {
    if (!record.product_id) {
      showToast("This record has no associated product and cannot be marked as damaged.", "error");
      return;
    }
    const damagedQty = parseInt(damagedQtyStr) || 0;
    if (damagedQty < 1 || damagedQty > record.quantity) {
      showToast(`Damaged quantity must be between 1 and ${record.quantity}`, "warning");
      return;
    }
    const prevRecords = records;
    const newQty = record.quantity - damagedQty;
    const newStatus = newQty === 0 ? "DAMAGED" : "PARTIALLY_DAMAGED";
    const updated = records.map((r) =>
      r.id === record.id && r.product_id === record.product_id
        ? { ...r, quantity: newQty, damaged_quantity: r.damaged_quantity + damagedQty, status: newStatus }
        : r
    );
    setDamagedRowIdx(null);
    setDamagedQtyStr("1");
    setRecords(updated);
    setDamageLoading(true);
    try {
      const res = await authFetch(`/api/lending/${record.id}/damage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: record.product_id, damaged_quantity: damagedQty }),
      });
      if (!res.ok) {
        setRecords(prevRecords);
        const data = await res.json();
        showToast(data.error || "Failed to mark items as damaged", "error");
      }
    } catch (error) {
      setRecords(prevRecords);
      console.error("Error marking items as damaged:", error);
    } finally {
      setDamageLoading(false);
    }
  };

  const handleMarkLost = async (record: LendingRecord) => {
    if (!record.product_id) {
      showToast("This record has no associated product and cannot be marked as lost.", "error");
      return;
    }
    const lostQty = parseInt(lostQtyStr) || 0;
    if (lostQty < 1 || lostQty > record.quantity) {
      showToast(`Lost quantity must be between 1 and ${record.quantity}`, "warning");
      return;
    }
    const prevRecords = records;
    const newQty = record.quantity - lostQty;
    const newStatus = newQty === 0 ? "LOST" : "PARTIALLY_LOST";
    const updated = records.map((r) =>
      r.id === record.id && r.product_id === record.product_id
        ? { ...r, quantity: newQty, lost_quantity: r.lost_quantity + lostQty, status: newStatus }
        : r
    );
    setLostRowIdx(null);
    setLostQtyStr("1");
    setRecords(updated);
    setLostLoading(true);
    try {
      const res = await authFetch(`/api/lending/${record.id}/lost`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: record.product_id, lost_quantity: lostQty }),
      });
      if (!res.ok) {
        setRecords(prevRecords);
        const data = await res.json();
        showToast(data.error || "Failed to mark items as lost", "error");
      }
    } catch (error) {
      setRecords(prevRecords);
      console.error("Error marking items as lost:", error);
    } finally {
      setLostLoading(false);
    }
  };

  const handleReturnDateUpdate = async (recordId: number, productId: string | null, returnDate: string, returnQty?: number) => {
    const prevRecords = records;
    const existingRecord = records.find((r) => r.id === recordId && r.product_id === productId);
    if (!existingRecord) return;

    const currentOutstanding = existingRecord.quantity;
    const nowReturning = returnQty ?? currentOutstanding;
    const remaining = currentOutstanding - nowReturning;

    // Order-level status must account for every item in the order (which
    // may include CONSUMABLE items not shown on this page) — records here
    // is the full unfiltered fetch, only the table display is filtered.
    const orderRecords = records.filter((r) => r.id === recordId);
    const totalOutstandingAfter = orderRecords.reduce(
      (sum, r) => sum + (r.product_id === productId ? remaining : r.quantity || 0),
      0
    );
    const anyDamagedInOrder = orderRecords.some((r) => (r.damaged_quantity || 0) > 0);
    const anyLostInOrder = orderRecords.some((r) => (r.lost_quantity || 0) > 0);

    let newOrderStatus: string;
    if (totalOutstandingAfter > 0) {
      const curStatus = existingRecord.status;
      if (curStatus === "PARTIALLY_DAMAGED" || curStatus === "DAMAGED") newOrderStatus = "PARTIALLY_DAMAGED";
      else if (curStatus === "PARTIALLY_LOST") newOrderStatus = "PARTIALLY_LOST";
      else newOrderStatus = "PARTIALLY_RETURNED";
    } else {
      if (anyDamagedInOrder) newOrderStatus = "RETURNED_DAMAGED";
      else if (anyLostInOrder) newOrderStatus = "RETURNED_LOST";
      else newOrderStatus = "RETURNED";
    }

    const updated = records.map((r) => {
      if (r.id !== recordId) return r;
      if (r.product_id === productId) return { ...r, quantity: remaining, status: newOrderStatus, return_date: returnDate };
      return { ...r, status: newOrderStatus };
    });
    setRecords(updated);
    setReturnPickerRowIdx(null);
    setReturnPickerDate("");
    setReturnPickerQty(1);
    try {
      const res = await authFetch(`/api/lending/${recordId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ return_date: returnDate, quantity: remaining, product_id: productId }),
      });
      if (!res.ok) {
        setRecords(prevRecords);
        console.error("Failed to update return date");
      }
    } catch (error) {
      setRecords(prevRecords);
      console.error("Error updating return date:", error);
    }
  };

  const uniqueDepartments = Array.from(
    records.reduce((map, r) => {
      if (r.department && r.department !== "—" && !map.has(r.department)) map.set(r.department, r.department_code ?? null);
      return map;
    }, new Map<string, string | null>())
  ).map(([name, code]) => ({ name, code }));
  const uniqueProducts = Array.from(new Set(records.filter((r) => r.item_type === "RETURNABLE").map((r) => r.product_name).filter(Boolean)));

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

  const displayRecords = records
    .filter((r) => r.item_type === "RETURNABLE")
    .filter(
      (r) =>
        !searchQuery ||
        r.borrower_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.student_id_code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.product_name?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .filter((r) => !deptFilter || r.department === deptFilter)
    .filter((r) => !statusFilter || matchesStatusFilter(r.status, statusFilter))
    .filter((r) => !productFilter || r.product_name === productFilter)
    .filter((r) => inDateRange(r.lending_date, dateFrom, dateTo));

  const pendingItemCount = displayRecords.filter((r) => PENDING_STATUSES.includes(r.status)).length;
  const returnedItemCount = displayRecords.length - pendingItemCount;

  // Item-level split, not group-level — a single (student, date) visit can
  // mix already-returned and still-outstanding items, so the same group may
  // legitimately show up on both tabs with a different subset of items.
  const tabRecords = displayRecords.filter((r) =>
    activeTab === "pending" ? PENDING_STATUSES.includes(r.status) : !PENDING_STATUSES.includes(r.status)
  );

  // Two lending_order rows for the same student on the same day (a split
  // multi-item submission, or a re-scanned entry) read as one row here —
  // see groupByStudentAndDate for why grouping is date-local, not UTC.
  const groups = groupByStudentAndDate(tabRecords);

  let sortedGroups = groups;
  if (sortCol) {
    sortedGroups = [...groups].sort((a, b) => {
      let av: number, bv: number;
      if (sortCol === "lending_date") { av = new Date(a.date).getTime(); bv = new Date(b.date).getTime(); }
      else if (sortCol === "due_date") {
        av = Math.min(...a.records.map((r) => (r.due_date ? new Date(r.due_date).getTime() : -Infinity)));
        bv = Math.min(...b.records.map((r) => (r.due_date ? new Date(r.due_date).getTime() : -Infinity)));
      } else if (sortCol === "return_date") {
        av = Math.min(...a.records.map((r) => (r.return_date ? new Date(r.return_date).getTime() : -Infinity)));
        bv = Math.min(...b.records.map((r) => (r.return_date ? new Date(r.return_date).getTime() : -Infinity)));
      } else {
        av = a.records.reduce((s, r) => s + (r.original_quantity ?? r.quantity), 0);
        bv = b.records.reduce((s, r) => s + (r.original_quantity ?? r.quantity), 0);
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
  } else {
    sortedGroups = [...groups].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  const { page, setPage, totalPages, padRows, showAll, setShowAll, startIdx, endIdx, total } = usePagination(sortedGroups, { pageSize: 50 });

  const applyDatePreset = (preset: DatePreset) => {
    const { from, to } = presetRange(preset);
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
  };

  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // The per-item row — used both for a single-item group (identical to the
  // page's original row-per-record behavior) and for each item revealed
  // when a multi-item group is expanded, where identity columns are left
  // blank (the summary row above already shows them) and the product name
  // is indented to read as a sub-row.
  function renderItemRow(record: LendingRecord, flatIdx: number, groupIdx: number, nested: boolean) {
    const c = computeItemCounts(record);
    const qCell = (v: number, color: string) => (
      <td style={{ ...td, textAlign: "center", color: v > 0 ? color : "var(--muted)", fontWeight: v > 0 ? 600 : 400 }}>{v > 0 ? v : "—"}</td>
    );
    return (
      <tr key={`${record.id}-${record.product_id ?? "none"}-${flatIdx}`} style={nested ? { background: "var(--surface)" } : undefined}>
        <td style={td}></td>
        <td style={{ ...td, color: "var(--muted)" }}>{nested ? "" : groupIdx + 1}</td>
        <td style={{ ...td, whiteSpace: "nowrap" }}>{nested ? "" : (record.borrower_name || "—")}</td>
        <td style={{ ...td, fontFamily: "monospace", fontSize: 11 }}>{nested ? "" : (record.student_id_code || "—")}</td>
        <td style={td}>{nested ? "" : (record.department_code || record.department || "—")}</td>
        <td style={{ ...td, whiteSpace: "nowrap" }}>{nested ? "" : `${record.domain_name}${record.room_name !== "—" ? ` / ${record.room_name}` : ""}`}</td>
        <td style={{ ...td, maxWidth: 220 }}>
          <div style={{ overflowX: "auto", whiteSpace: "nowrap", paddingLeft: nested ? 22 : undefined }} title={record.product_name || undefined}>
            {record.product_name || "—"}
          </div>
        </td>
        <td style={{ ...td, textAlign: "center" }}>{c.borrowed}</td>
        {qCell(c.retd, "#16a34a")}
        {qCell(c.damaged, "#dc2626")}
        {qCell(c.lost, "#d97706")}
        {qCell(c.balance, "#92400e")}
        <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDate(record.lending_date)}</td>
        <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDate(record.due_date)}</td>
        <td style={{ ...td, whiteSpace: "nowrap" }}>
          {record.return_date ? (
            <span>{formatDate(record.return_date)}</span>
          ) : (
            <button
              onClick={() => { setReturnPickerRowIdx(flatIdx); setReturnPickerDate(new Date().toISOString().split("T")[0]); setReturnPickerQty(record.quantity); }}
              title="Set return date"
              style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 11, textDecoration: "underline", padding: 0 }}
            >
              Set Date
            </button>
          )}
        </td>
        <td className="sticky-col" style={{ ...td, right: 0, width: STATUS_COL_WIDTH, background: nested ? "var(--surface)" : "#fff" }}>
          {PENDING_STATUSES.includes(record.status) ? (
            <select
              value={record.status}
              onChange={(e) => {
                if (e.target.value === "DO_DAMAGED") { setDamagedRowIdx(flatIdx); setDamagedQtyStr("1"); }
                else if (e.target.value === "DO_LOST") { setLostRowIdx(flatIdx); setLostQtyStr("1"); }
                else if (e.target.value === "DO_RETURN") { setReturnPickerRowIdx(flatIdx); setReturnPickerDate(new Date().toISOString().split("T")[0]); setReturnPickerQty(record.quantity); }
              }}
              className="dropdown-control"
              style={{ fontSize: 12, fontWeight: 600, padding: "6px 10px", border: "1px solid var(--border)", background: "#fff", color: "var(--fg)", cursor: "pointer", width: "100%", maxWidth: STATUS_COL_WIDTH - 20, boxSizing: "border-box", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              <option value={record.status}>
                {record.status === "PENDING" ? "PENDING" : record.status === "PARTIALLY_RETURNED" ? "PARTIALLY RETURNED" : record.status === "PARTIALLY_DAMAGED" ? "PARTIALLY DAMAGED" : "PARTIALLY LOST"}
              </option>
              <option value="DO_RETURN">Mark as Returned</option>
              <option value="DO_DAMAGED">Mark as Damaged</option>
              <option value="DO_LOST">Mark as Lost</option>
            </select>
          ) : (
            (() => {
              const d = record.damaged_quantity ?? 0;
              const l = record.lost_quantity ?? 0;
              const orig = record.original_quantity != null && record.original_quantity > 0 ? record.original_quantity : record.quantity;
              const returnedCount = Math.max(0, orig - d - l);
              const hasPills = returnedCount > 0 || d > 0 || l > 0;
              if (hasPills) {
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {returnedCount > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", background: "#dcfce7", color: "#166534", whiteSpace: "nowrap" }}>{returnedCount} Returned</span>}
                    {d > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", background: "#fee2e2", color: "#991b1b", whiteSpace: "nowrap" }}>{d} Damaged</span>}
                    {l > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", background: "#fef3c7", color: "#92400e", whiteSpace: "nowrap" }}>{l} Lost</span>}
                  </div>
                );
              }
              return <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", background: "var(--surface)", color: "var(--muted)" }}>{record.status || "—"}</span>;
            })()
          )}
        </td>
      </tr>
    );
  }

  if (loading) return <div style={{ padding: 20, fontSize: 12, color: "var(--muted)" }}>Loading returnable records…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg)" }}>Returnable</div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Mark returnable items as returned, damaged, or lost</div>
      </div>

      {/* Pending Return / Returned tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "var(--surface)", padding: 4, borderRadius: 6, width: "fit-content" }}>
        <button
          onClick={() => { setActiveTab("pending"); setPage(1); }}
          className="seg-tab-btn"
          style={{ background: activeTab === "pending" ? "var(--accent)" : "transparent", color: activeTab === "pending" ? "#fff" : "var(--fg)" }}
        >
          Pending Return{displayRecords.length > 0 ? ` (${pendingItemCount})` : ""}
        </button>
        <button
          onClick={() => { setActiveTab("returned"); setPage(1); }}
          className="seg-tab-btn"
          style={{ background: activeTab === "returned" ? "var(--accent)" : "transparent", color: activeTab === "returned" ? "#fff" : "var(--fg)" }}
        >
          Returned{displayRecords.length > 0 ? ` (${returnedItemCount})` : ""}
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <select value={deptFilter} onChange={(e) => { setDeptFilter(e.target.value); setPage(1); }} style={selectStyle} className="dropdown-control">
          <option value="">All Departments</option>
          {uniqueDepartments.map((d) => <option key={d.name} value={d.name}>{d.code || d.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={selectStyle} className="dropdown-control">
          <option value="">All Status</option>
          <option value="PENDING">Pending</option>
          <option value="RETURNED">Returned</option>
          <option value="DAMAGED">Damaged</option>
          <option value="LOST">Lost</option>
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
        {(deptFilter || statusFilter || productFilter || searchQuery || dateFrom || dateTo) && (
          <button
            onClick={() => { setDeptFilter(""); setStatusFilter(""); setProductFilter(""); setSearchQuery(""); setDateFrom(""); setDateTo(""); setPage(1); }}
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
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--surface)" }}>
              <tr>
                <th style={{ ...th, width: 40 }}></th>
                {["S.No", "Student", "Student ID", "Dept", "Domain/Room", "Product"].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
                <th onClick={() => handleSort("original_quantity")} style={{ ...th, cursor: "pointer" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>Borrowed <SortIcon col="original_quantity" /></span>
                </th>
                {["Returned", "Damaged", "Lost", "Balance"].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
                <th onClick={() => handleSort("lending_date")} style={{ ...th, cursor: "pointer" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>Lent Date <SortIcon col="lending_date" /></span>
                </th>
                <th onClick={() => handleSort("due_date")} style={{ ...th, cursor: "pointer" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>Due Date <SortIcon col="due_date" /></span>
                </th>
                <th onClick={() => handleSort("return_date")} style={{ ...th, cursor: "pointer" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>Return Date <SortIcon col="return_date" /></span>
                </th>
                <th className="sticky-col" style={{ ...th, right: 0, width: STATUS_COL_WIDTH, background: "var(--surface)" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {tabRecords.length === 0 ? (
                <tr><td colSpan={16} style={{ ...td, textAlign: "center", color: "var(--muted)", padding: "24px 10px" }}>{activeTab === "pending" ? "No pending returns" : "No returned records"} found</td></tr>
              ) : (
                padRows.map((group, localIdx) => {
                  if (!group) {
                    return (
                      <tr key={`empty-${localIdx}`}>
                        <td style={{ ...td, border: "none" }} colSpan={16}>&nbsp;</td>
                      </tr>
                    );
                  }
                  const groupIdx = showAll ? localIdx : startIdx + localIdx;

                  if (group.records.length === 1) {
                    const record = group.records[0];
                    return renderItemRow(record, displayRecords.indexOf(record), groupIdx, false);
                  }

                  const isExpanded = expandedKeys.has(group.key);
                  const agg = group.records.reduce((a, r) => {
                    const c = computeItemCounts(r);
                    return { borrowed: a.borrowed + c.borrowed, retd: a.retd + c.retd, damaged: a.damaged + c.damaged, lost: a.lost + c.lost, balance: a.balance + c.balance };
                  }, { borrowed: 0, retd: 0, damaged: 0, lost: 0, balance: 0 });
                  const first = group.records[0];
                  const allDueDatesMatch = group.records.every((r) => r.due_date === first.due_date);
                  const allReturnDatesMatch = group.records.every((r) => r.return_date === first.return_date);
                  const qCell = (v: number, color: string) => (
                    <td style={{ ...td, textAlign: "center", color: v > 0 ? color : "var(--muted)", fontWeight: v > 0 ? 600 : 400 }}>{v > 0 ? v : "—"}</td>
                  );

                  return (
                    <Fragment key={group.key}>
                      <tr style={isExpanded ? { background: "var(--surface)" } : undefined}>
                        <td style={{ ...td, textAlign: "center" }}>
                          <button
                            onClick={() => toggleExpanded(group.key)}
                            title={isExpanded ? "Collapse" : `Show ${group.records.length} items`}
                            className="row-toggle-btn"
                          >
                            {isExpanded ? "▾" : "▸"}
                          </button>
                        </td>
                        <td style={{ ...td, color: "var(--muted)" }}>{groupIdx + 1}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{first.borrower_name || "—"}</td>
                        <td style={{ ...td, fontFamily: "monospace", fontSize: 11 }}>{first.student_id_code || "—"}</td>
                        <td style={td}>{first.department_code || first.department || "—"}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{first.domain_name}{first.room_name !== "—" ? ` / ${first.room_name}` : ""}</td>
                        <td style={{ ...td, maxWidth: 220 }}>
                          <div style={{ overflowX: "auto", whiteSpace: "nowrap" }} title={group.records.map((r) => r.product_name).join(", ")}>
                            {group.records.length} items ({group.records.map((r) => r.product_name).filter(Boolean).join(", ")})
                          </div>
                        </td>
                        <td style={{ ...td, textAlign: "center" }}>{agg.borrowed}</td>
                        {qCell(agg.retd, "#16a34a")}
                        {qCell(agg.damaged, "#dc2626")}
                        {qCell(agg.lost, "#d97706")}
                        {qCell(agg.balance, "#92400e")}
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDate(group.date)}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{allDueDatesMatch ? formatDate(first.due_date) : "Multiple"}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{allReturnDatesMatch ? formatDate(first.return_date) : "Multiple"}</td>
                        <td className="sticky-col" style={{ ...td, right: 0, width: STATUS_COL_WIDTH, background: isExpanded ? "var(--surface)" : "#fff" }}>
                          {agg.retd > 0 || agg.damaged > 0 || agg.lost > 0 ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              {agg.retd > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", background: "#dcfce7", color: "#166534", whiteSpace: "nowrap" }}>{agg.retd} Returned</span>}
                              {agg.damaged > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", background: "#fee2e2", color: "#991b1b", whiteSpace: "nowrap" }}>{agg.damaged} Damaged</span>}
                              {agg.lost > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", background: "#fef3c7", color: "#92400e", whiteSpace: "nowrap" }}>{agg.lost} Lost</span>}
                              {agg.balance > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", background: "var(--surface)", color: "var(--muted)" }}>{agg.balance} Pending</span>}
                            </div>
                          ) : (
                            <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", background: "var(--surface)", color: "var(--muted)" }}>PENDING</span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && group.records.map((record) => renderItemRow(record, displayRecords.indexOf(record), groupIdx, true))}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", background: "var(--surface)", padding: "8px 12px", borderTop: "1px solid var(--border)" }}>
          <span>{total > 0 ? `Showing ${showAll ? total : Math.min(startIdx + 1, total)}–${showAll ? total : Math.min(endIdx, total)} of ${total}` : (activeTab === "pending" ? "No pending returns found" : "No returned records found")}</span>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} showAll={showAll} onToggleShowAll={setShowAll} />
        </div>
      </div>

      {/* Return Date Modal */}
      {returnPickerRowIdx !== null && displayRecords[returnPickerRowIdx] && (() => {
        const rec = displayRecords[returnPickerRowIdx];
        const isPartiallyDamaged = rec.status === "PARTIALLY_DAMAGED";
        const isPartiallyLost = rec.status === "PARTIALLY_LOST";
        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)" }}>
            <div style={{ background: "#fff", border: "1px solid var(--border)", padding: 24, width: 360, maxWidth: "90vw" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)", marginBottom: 4 }}>Set Return Date</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>Product: <strong style={{ color: "var(--fg)" }}>{rec.product_name}</strong></div>
              {isPartiallyDamaged && (
                <div style={{ fontSize: 11, color: "#991b1b", background: "#fee2e2", padding: "6px 10px", marginBottom: 12 }}>
                  {rec.damaged_quantity ?? 0} item{(rec.damaged_quantity ?? 0) !== 1 ? "s were" : " was"} damaged. Returning the remaining {rec.quantity} item{rec.quantity !== 1 ? "s" : ""} → status will be Returned (Damaged).
                </div>
              )}
              {isPartiallyLost && (
                <div style={{ fontSize: 11, color: "#92400e", background: "#fef3c7", padding: "6px 10px", marginBottom: 12 }}>
                  {rec.lost_quantity ?? 0} item{(rec.lost_quantity ?? 0) !== 1 ? "s were" : " was"} lost. Returning the remaining {rec.quantity} item{rec.quantity !== 1 ? "s" : ""} → status will be Returned (Lost).
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Return Date</div>
                  <input type="date" value={returnPickerDate} max={new Date().toISOString().split("T")[0]} onChange={(e) => setReturnPickerDate(e.target.value)}
                    style={{ width: "100%", padding: "5px 8px", border: "1px solid var(--border)", fontSize: 12, color: "var(--fg)", boxSizing: "border-box" as const }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Qty Returned (max {rec.quantity})</div>
                  <input type="number" min={1} max={rec.quantity} value={returnPickerQty} onChange={(e) => setReturnPickerQty(Math.min(rec.quantity, Math.max(1, parseInt(e.target.value) || 1)))}
                    style={{ width: "100%", padding: "5px 8px", border: "1px solid var(--border)", fontSize: 12, color: "var(--fg)", boxSizing: "border-box" as const }} />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button onClick={() => { setReturnPickerRowIdx(null); setReturnPickerDate(""); setReturnPickerQty(1); }} disabled={returnPickerLoading}
                  style={{ padding: "5px 14px", fontSize: 12, border: "1px solid var(--border)", background: "#fff", color: "var(--fg)", cursor: "pointer" }}>Cancel</button>
                <button
                  onClick={async () => { if (!returnPickerDate) { showToast("Please select a return date.", "warning"); return; } setReturnPickerLoading(true); await handleReturnDateUpdate(rec.id, rec.product_id, returnPickerDate, returnPickerQty); setReturnPickerLoading(false); }}
                  disabled={returnPickerLoading || !returnPickerDate}
                  style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, background: "#16a34a", color: "#fff", border: "none", cursor: "pointer", opacity: returnPickerLoading || !returnPickerDate ? 0.5 : 1 }}>
                  {returnPickerLoading ? "Saving..." : "Confirm Return"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Damage Modal */}
      {damagedRowIdx !== null && displayRecords[damagedRowIdx] && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)" }}>
          <div style={{ background: "#fff", border: "1px solid var(--border)", padding: 24, width: 360, maxWidth: "90vw" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)", marginBottom: 4 }}>Mark Items as Damaged</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 16 }}>
              Product: <strong style={{ color: "var(--fg)" }}>{displayRecords[damagedRowIdx].product_name}</strong><br />
              Lent qty: <strong style={{ color: "var(--fg)" }}>{displayRecords[damagedRowIdx].quantity}</strong>
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Number of Damaged Items</div>
            <input type="number" min={1} max={displayRecords[damagedRowIdx].quantity} value={damagedQtyStr} onChange={(e) => setDamagedQtyStr(e.target.value)}
              style={{ width: "100%", padding: "5px 8px", border: "1px solid var(--border)", fontSize: 12, color: "var(--fg)", marginBottom: 16, boxSizing: "border-box" as const }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => { setDamagedRowIdx(null); setDamagedQtyStr("1"); }} disabled={damageLoading}
                style={{ padding: "5px 14px", fontSize: 12, border: "1px solid var(--border)", background: "#fff", color: "var(--fg)", cursor: "pointer" }}>Cancel</button>
              <button onClick={() => handleMarkDamaged(displayRecords[damagedRowIdx]!)} disabled={damageLoading}
                style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, background: "#dc2626", color: "#fff", border: "none", cursor: "pointer", opacity: damageLoading ? 0.5 : 1 }}>
                {damageLoading ? "Saving..." : "Confirm Damaged"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lost Modal */}
      {lostRowIdx !== null && displayRecords[lostRowIdx] && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)" }}>
          <div style={{ background: "#fff", border: "1px solid var(--border)", padding: 24, width: 360, maxWidth: "90vw" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)", marginBottom: 4 }}>Mark Items as Lost</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 16 }}>
              Product: <strong style={{ color: "var(--fg)" }}>{displayRecords[lostRowIdx].product_name}</strong><br />
              Lent qty: <strong style={{ color: "var(--fg)" }}>{displayRecords[lostRowIdx].quantity}</strong>
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Number of Lost Items</div>
            <input type="number" min={1} max={displayRecords[lostRowIdx].quantity} value={lostQtyStr} onChange={(e) => setLostQtyStr(e.target.value)}
              style={{ width: "100%", padding: "5px 8px", border: "1px solid var(--border)", fontSize: 12, color: "var(--fg)", marginBottom: 16, boxSizing: "border-box" as const }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => { setLostRowIdx(null); setLostQtyStr("1"); }} disabled={lostLoading}
                style={{ padding: "5px 14px", fontSize: 12, border: "1px solid var(--border)", background: "#fff", color: "var(--fg)", cursor: "pointer" }}>Cancel</button>
              <button onClick={() => handleMarkLost(displayRecords[lostRowIdx]!)} disabled={lostLoading}
                style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, background: "#d97706", color: "#fff", border: "none", cursor: "pointer", opacity: lostLoading ? 0.5 : 1 }}>
                {lostLoading ? "Saving..." : "Confirm Lost"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
