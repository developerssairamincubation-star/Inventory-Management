"use client";
import { authFetch, useUser } from "@/contexts/UserContext";
import { extractErrorMessage } from "@/lib/extractErrorMessage";

import { Fragment, useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowUpNarrowWide, ArrowUpWideNarrow } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import Pagination from "@/components/Pagination";
import { usePagination } from "@/hooks/usePagination";
import { groupByStudentAndDate, computeItemCounts } from "@/lib/groupLendingRecords";
import { decodeStudentIdCode } from "@/lib/studentIdCode";

// Utility function to format date as DD/MM/YYYY
const formatDate = (dateString: string | null): string => {
  if (!dateString) return "—";
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

type SortCol = 'lending_date' | 'due_date' | 'return_date' | 'original_quantity' | null;
type SortDir = 'asc' | 'desc';

function matchesStatusFilter(status: string, filter: string): boolean {
  if (!filter) return true;
  const s = status?.toUpperCase() ?? '';
  if (filter === 'CONSUMABLE') return s === 'CONSUMABLE';
  if (filter === 'RETURNED') return ['RETURNED', 'RETURNED_DAMAGED', 'RETURNED_LOST'].includes(s);
  if (filter === 'DAMAGED') return ['DAMAGED', 'PARTIALLY_DAMAGED', 'RETURNED_DAMAGED'].includes(s);
  if (filter === 'LOST') return ['LOST', 'PARTIALLY_LOST', 'RETURNED_LOST'].includes(s);
  if (filter === 'PENDING') return ['PENDING', 'PARTIALLY_RETURNED', 'PARTIALLY_DAMAGED', 'PARTIALLY_LOST'].includes(s);
  return true;
}

const selectStyle: React.CSSProperties = {
  fontSize: 13,
  border: '1px solid var(--border)',
  padding: '8px 12px',
  color: 'var(--fg)',
  background: 'var(--bg)',
  outline: 'none',
  cursor: 'pointer',
  minWidth: 130,
};

// End-of-row sticky Status/Actions columns — keep these fixed widths in
// sync with the `right` offsets on the sticky th/td styles below.
const ACTIONS_COL_WIDTH = 90;
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
  item_type: 'RETURNABLE' | 'CONSUMABLE' | null;
  original_quantity: number;   // total initially borrowed
  quantity: number;            // current remaining (outstanding or returned)
  damaged_quantity: number;    // items marked damaged
  lost_quantity: number;       // items marked lost
  lending_date: string;
  due_date: string;
  return_date: string | null;
  status: string;
};

type Department = {
  department_id: string;
  department_name: string;
  code: string | null;
};

type Product = {
  product_id: string;
  product_name: string;
  sku_code: string | null;
};

type CoeDomain = {
  domain_id: string;
  domain_name: string;
  room_name: string;
};

// One product line within a student's row — a row can hold several of
// these (e.g. a student borrowing more than one item in a single visit).
// dueDateValue is the single canonical due-date value; the Date and Days
// inputs are just two synced views onto it (see dueDateDays/daysToDate).
type LendingProductLine = {
  id: string;
  productQuery: string;
  skuQuery: string;
  productId: string;
  productName: string;
  quantity: number | "";
  itemType: "RETURNABLE" | "CONSUMABLE";
  dueDateValue: string;
};

const createEmptyLine = (id: string): LendingProductLine => ({
  id,
  productQuery: "",
  skuQuery: "",
  productId: "",
  productName: "",
  quantity: 1,
  itemType: "RETURNABLE",
  dueDateValue: "",
});

// A single card in the "Add Entry" form — one scanned student and one or
// more product lines. Cloning a row deep-copies its product lines but
// resets the student's identity, which must be freshly scanned per person.
type LendingFormRow = {
  id: string;
  studentIdCode: string;
  decoded: null | {
    department_id: string | null;
    department_name: string | null;
    college_name: string | null;
    year_of_study: number | string;
    is_lateral_entry: boolean;
    existing: boolean;
    student_name: string | null;
  };
  decodeError: string | null;
  studentName: string;
  items: LendingProductLine[];
};

const createEmptyRow = (id: string): LendingFormRow => ({
  id,
  studentIdCode: "",
  decoded: null,
  decodeError: null,
  studentName: "",
  items: [createEmptyLine(`${id}-1`)],
});

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Days-from-today <-> ISO date, the two synced views of dueDateValue (3c).
function dueDateToDays(dueDateValue: string): number | "" {
  if (!dueDateValue) return "";
  const d = new Date(`${dueDateValue}T00:00:00`);
  if (isNaN(d.getTime())) return "";
  return Math.round((d.getTime() - startOfToday().getTime()) / 86400000);
}

// Local-date formatting, not toISOString — that converts to UTC first,
// which silently shifts the date by one in timezones ahead of UTC (local
// midnight can fall on the previous UTC day).
function toLocalISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysToDueDate(days: number): string {
  const d = new Date(startOfToday());
  d.setDate(d.getDate() + days);
  return toLocalISODate(d);
}

// The product-search dropdown used to be an absolutely-positioned <div>
// anchored inside the rows list, but that list scrolls (overflow-y: auto),
// and a container with overflow-y:auto becomes a clipping context on both
// axes — so the dropdown was invisible/clipped for any row not near the
// very top. Rendering it into a portal at document.body, positioned via
// the anchor input's own bounding rect, escapes that clipping entirely.
function ProductSearchDropdown({
  anchorEl,
  open,
  products,
  onSelect,
}: {
  anchorEl: HTMLElement | null;
  open: boolean;
  products: { product_id: string; product_name: string }[];
  onSelect: (product: { product_id: string; product_name: string }) => void;
}) {
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open || !anchorEl) { setRect(null); return; }
    const update = () => {
      const r = anchorEl.getBoundingClientRect();
      setRect({ top: r.bottom, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, anchorEl]);

  if (!open || !rect || products.length === 0 || typeof document === "undefined") return null;

  return createPortal(
    <div
      style={{
        position: "fixed", top: rect.top, left: rect.left, width: rect.width, zIndex: 1000,
        background: "#fff", border: "1px solid var(--border)", maxHeight: 180, overflowY: "auto",
        boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
      }}
    >
      {products.map((product) => (
        <button
          key={product.product_id}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(product)}
          style={{ display: "block", width: "100%", padding: "5px 8px", textAlign: "left", fontSize: 11, color: "var(--fg)", background: "none", border: "none", cursor: "pointer" }}
        >
          {product.product_name}
        </button>
      ))}
    </div>,
    document.body
  );
}

// const th: React.CSSProperties = {
//     border: '1px solid #1D293780',
// };
// const td: React.CSSProperties = {
//   border: '1px solid #1D293780',
// };

export default function LendingPage() {
  const { appUser } = useUser();
  const [records, setRecords] = useState<LendingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState("Monthly");
  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Modal form state — a list of student cards, see LendingFormRow above.
  const [formRows, setFormRows] = useState<LendingFormRow[]>([createEmptyRow("1")]);
  const [cloneCount, setCloneCount] = useState<number | "">(5);
  const [lendingDate, setLendingDate] = useState(new Date().toISOString().split("T")[0]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [coeDomains, setCoeDomains] = useState<CoeDomain[]>([]);
  const [adminDomainId, setAdminDomainId] = useState(""); // only used when appUser has no domain
  const [lineDropdown, setLineDropdown] = useState<{ rowId: string; lineId: string } | null>(null);
  // Both keyed by `${rowId}:${lineId}` — one product line's own errors.
  const [lineStockError, setLineStockError] = useState<{ [key: string]: string }>({});
  const [rowSubmitStatus, setRowSubmitStatus] = useState<{ [rowId: string]: "ok" | "error" }>({});
  const [editingReturnDate, setEditingReturnDate] = useState<number | null>(null);
  const [editQtyStr, setEditQtyStr] = useState<string>('');
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editFormData, setEditFormData] = useState<Partial<LendingRecord>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);
  // Anchor elements for the portal-rendered product-search dropdown, keyed
  // by product-line id (see ProductSearchDropdown above).
  const productInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  // Student ID inputs, keyed by row id — lets F2/Enter jump straight to the
  // next row's ID field for fast scan-through-many-cloned-rows entry.
  const studentIdInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Filters
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [itemTypeFilter, setItemTypeFilter] = useState('');

  // Sort
  const [sortCol, setSortCol] = useState<SortCol>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Damage-related state
  const [damagedRowIdx, setDamagedRowIdx] = useState<number | null>(null);
  const [damagedQtyStr, setDamagedQtyStr] = useState<string>("1");
  const [damageLoading, setDamageLoading] = useState(false);

  // Lost-related state
  const [lostRowIdx, setLostRowIdx] = useState<number | null>(null);
  const [lostQtyStr, setLostQtyStr] = useState<string>("1");
  const [lostLoading, setLostLoading] = useState(false);

  const { showToast, showConfirm } = useToast();

  // Return-from-dropdown modal state
  const [returnPickerRowIdx, setReturnPickerRowIdx] = useState<number | null>(null);
  const [returnPickerDate, setReturnPickerDate] = useState<string>("");
  const [returnPickerQty, setReturnPickerQty] = useState<number>(1);
  const [returnPickerLoading, setReturnPickerLoading] = useState(false);

  // Which multi-item (student, date) groups are expanded to show their
  // individual item rows — see groupByStudentAndDate.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // Stats
  const [totalLent, setTotalLent] = useState(0);
  const [totalQuantity, setTotalQuantity] = useState(0);
  const [returned, setReturned] = useState(0);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    fetchLendingRecords();
    fetchDepartments();
    fetchProducts();
    if (!appUser?.domain) fetchDomains();
  }, [timeFilter, appUser?.domain]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target as Node)) {
        setShowExportDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, timeFilter, deptFilter, statusFilter, productFilter, itemTypeFilter, sortCol, sortDir]);

  async function fetchDepartments() {
    try {
      const res = await authFetch("/api/departments");
      if (res.ok) {
        const data = await res.json();
        setDepartments(data || []);
      }
    } catch (error) {
      console.error("Error fetching departments:", error);
    }
  }

  async function fetchProducts() {
    try {
      const res = await authFetch("/api/products");
      if (res.ok) {
        const data = await res.json();
        setProducts(data || []);
      }
    } catch (error) {
      console.error("Error fetching products:", error);
    }
  }

  // Only needed when the issuing user has no domain of their own (e.g.
  // super_admin) — they pick one manually per submission.
  async function fetchDomains() {
    try {
      const res = await authFetch("/api/coe-domains");
      if (res.ok) {
        const data = await res.json();
        setCoeDomains(data || []);
      }
    } catch (error) {
      console.error("Error fetching COE domains:", error);
    }
  }

  async function fetchLendingRecords() {
    try {
      setLoading(true);
      const res = await authFetch(`/api/lending?period=${timeFilter.toLowerCase()}`);
      if (res.ok) {
        const data = await res.json();
        const fetched = data.records || [];
        setRecords(fetched);
        applyStats(fetched);
      } else {
        console.error("Failed to fetch lending records:", res.status);
        showToast("Couldn't load lending records. Please refresh and try again.", "error");
      }
    } catch (error) {
      console.error("Error fetching lending records:", error);
      showToast("Couldn't load lending records. Please check your connection and try again.", "error");
    } finally {
      setLoading(false);
    }
  }

  // Recalculate header stats from a records array without a full fetch
  const FINAL_STATUSES = ["RETURNED", "RETURNED_DAMAGED", "RETURNED_LOST", "DAMAGED", "LOST"];

  const applyStats = (recs: LendingRecord[]) => {
    const active = recs.filter(r => !FINAL_STATUSES.includes(r.status));
    setTotalLent(new Set(active.map(r => r.product_name).filter(n => n !== "—")).size);
    setTotalQuantity(active.reduce((s, r) => s + (r.quantity || 0), 0));
    setReturned(recs.filter(r => r.status === "RETURNED" || r.status === "RETURNED_DAMAGED" || r.status === "RETURNED_LOST").length);
    setPending(recs.filter(r =>
      r.status === "PENDING" ||
      r.status === "PARTIALLY_RETURNED" ||
      r.status === "PARTIALLY_DAMAGED" ||
      r.status === "PARTIALLY_LOST" ||
      r.status === "CONSUMABLE"
    ).length);
  };

  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sortCol !== col) return <ArrowUpNarrowWide size={11} style={{ opacity: 0.3, flexShrink: 0 }} />;
    return sortDir === 'asc'
      ? <ArrowUpNarrowWide size={11} style={{ flexShrink: 0, color: 'var(--accent)' }} />
      : <ArrowUpWideNarrow size={11} style={{ flexShrink: 0, color: 'var(--accent)' }} />;
  };

  const uniqueProducts = Array.from(new Set(records.map(r => r.product_name).filter(Boolean)));

  const filteredRecords = records.filter((record) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const match = (
        record.borrower_name?.toLowerCase().includes(query) ||
        record.student_id_code?.toLowerCase().includes(query) ||
        record.department?.toLowerCase().includes(query) ||
        record.product_name?.toLowerCase().includes(query) ||
        record.status?.toLowerCase().includes(query)
      );
      if (!match) return false;
    }
    if (deptFilter && record.department !== deptFilter) return false;
    if (statusFilter && !matchesStatusFilter(record.status, statusFilter)) return false;
    if (productFilter && record.product_name !== productFilter) return false;
    if (itemTypeFilter && record.item_type !== itemTypeFilter) return false;
    return true;
  });

  // Two lending_order rows for the same student on the same day (a split
  // multi-item submission, or a re-scanned entry) read as one row here —
  // see groupByStudentAndDate for why grouping is date-local, not UTC.
  const groups = groupByStudentAndDate(filteredRecords);

  let sortedGroups = groups;
  if (sortCol) {
    sortedGroups = [...groups].sort((a, b) => {
      let av: number, bv: number;
      if (sortCol === 'lending_date') { av = new Date(a.date).getTime(); bv = new Date(b.date).getTime(); }
      else if (sortCol === 'due_date') {
        av = Math.min(...a.records.map((r) => (r.due_date ? new Date(r.due_date).getTime() : -Infinity)));
        bv = Math.min(...b.records.map((r) => (r.due_date ? new Date(r.due_date).getTime() : -Infinity)));
      } else if (sortCol === 'return_date') {
        av = Math.min(...a.records.map((r) => (r.return_date ? new Date(r.return_date).getTime() : -Infinity)));
        bv = Math.min(...b.records.map((r) => (r.return_date ? new Date(r.return_date).getTime() : -Infinity)));
      } else {
        av = a.records.reduce((s, r) => s + (r.original_quantity ?? r.quantity), 0);
        bv = b.records.reduce((s, r) => s + (r.original_quantity ?? r.quantity), 0);
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  } else {
    sortedGroups = [...groups].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  const { page, setPage, totalPages, padRows, showAll, setShowAll, startIdx } = usePagination(sortedGroups, { pageSize: 50 });

  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleDelete = async (id: number) => {
    if (!(await showConfirm("Are you sure you want to delete this lending record?"))) return;
    const prevRecords = records;
    const updated = records.filter(r => r.id !== id);
    setRecords(updated);
    applyStats(updated);
    try {
      const res = await authFetch(`/api/lending/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setRecords(prevRecords);
        applyStats(prevRecords);
        console.error("Failed to delete record:", res.status);
        showToast("Couldn't delete this record. Please try again.", "error");
      }
    } catch (error) {
      setRecords(prevRecords);
      applyStats(prevRecords);
      console.error("Error deleting record:", error);
      showToast("Couldn't delete this record. Please check your connection and try again.", "error");
    }
  };

  const handleEdit = (record: LendingRecord, index: number) => {
    setEditingRow(index);
    setEditQtyStr(String(record.quantity ?? ''));
    setEditFormData({
      id: record.id,
      quantity: record.quantity,
      due_date: record.due_date,
    });
  };

  const handleCancelEdit = () => {
    setEditingRow(null);
    setEditQtyStr('');
    setEditFormData({});
  };

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
    // Optimistic update
    const prevRecords = records;
    const newQty = record.quantity - damagedQty;
    const newStatus = newQty === 0 ? "DAMAGED" : "PARTIALLY_DAMAGED";
    const updated = records.map(r =>
      r.id === record.id && r.product_id === record.product_id
        ? { ...r, quantity: newQty, damaged_quantity: r.damaged_quantity + damagedQty, status: newStatus }
        : r
    );
    setDamagedRowIdx(null);
    setDamagedQtyStr("1");
    setRecords(updated);
    applyStats(updated);
    setDamageLoading(true);
    try {
      const res = await authFetch(`/api/lending/${record.id}/damage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: record.product_id,
          damaged_quantity: damagedQty,
        }),
      });
      if (!res.ok) {
        setRecords(prevRecords);
        applyStats(prevRecords);
        const data = await res.json();
        showToast(extractErrorMessage(data, "Failed to mark items as damaged"), "error");
      }
    } catch (error) {
      setRecords(prevRecords);
      applyStats(prevRecords);
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
    const updated = records.map(r =>
      r.id === record.id && r.product_id === record.product_id
        ? { ...r, quantity: newQty, lost_quantity: r.lost_quantity + lostQty, status: newStatus }
        : r
    );
    setLostRowIdx(null);
    setLostQtyStr("1");
    setRecords(updated);
    applyStats(updated);
    setLostLoading(true);
    try {
      const res = await authFetch(`/api/lending/${record.id}/lost`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: record.product_id,
          lost_quantity: lostQty,
        }),
      });
      if (!res.ok) {
        setRecords(prevRecords);
        applyStats(prevRecords);
        const data = await res.json();
        showToast(extractErrorMessage(data, "Failed to mark items as lost"), "error");
      }
    } catch (error) {
      setRecords(prevRecords);
      applyStats(prevRecords);
      console.error("Error marking items as lost:", error);
    } finally {
      setLostLoading(false);
    }
  };

  const handleSaveEdit = async () => {
    if (editingRow === null || !editFormData.id) return;
    const parsedQty = parseInt(editQtyStr) || (editFormData.quantity as number) || 1;
    const prevRecords = records;
    const updated = records.map(r =>
      r.id === editFormData.id
        ? { ...r, quantity: parsedQty, original_quantity: parsedQty, due_date: editFormData.due_date ?? r.due_date }
        : r
    );
    setRecords(updated);
    applyStats(updated);
    setEditingRow(null);
    setEditQtyStr('');
    setEditFormData({});
    try {
      const res = await authFetch(`/api/lending/${editFormData.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity: parsedQty,
          original_quantity: parsedQty,
          due_date: editFormData.due_date,
        }),
      });
      if (!res.ok) {
        setRecords(prevRecords);
        applyStats(prevRecords);
        console.error("Failed to update record:", res.status);
        showToast("Couldn't save that change. Please try again.", "error");
      }
    } catch (error) {
      setRecords(prevRecords);
      applyStats(prevRecords);
      console.error("Error updating record:", error);
      showToast("Couldn't save that change. Please check your connection and try again.", "error");
    }
  };

  const updateRow = (rowId: string, field: keyof LendingFormRow, value: any) => {
    setFormRows(prev => prev.map(r => r.id === rowId ? { ...r, [field]: value } : r));
  };

  const mergeRow = (rowId: string, fields: Partial<LendingFormRow>) => {
    setFormRows(prev => prev.map(r => r.id === rowId ? { ...r, ...fields } : r));
  };

  const updateLine = (rowId: string, lineId: string, field: keyof LendingProductLine, value: any) => {
    setFormRows(prev => prev.map(r => r.id !== rowId ? r : {
      ...r,
      items: r.items.map(l => l.id === lineId ? { ...l, [field]: value } : l),
    }));
  };

  const mergeLine = (rowId: string, lineId: string, fields: Partial<LendingProductLine>) => {
    setFormRows(prev => prev.map(r => r.id !== rowId ? r : {
      ...r,
      items: r.items.map(l => l.id === lineId ? { ...l, ...fields } : l),
    }));
  };

  const addBlankRow = () => {
    setFormRows(prev => [...prev, createEmptyRow(Date.now().toString())]);
  };

  const removeRow = (rowId: string) => {
    setFormRows(prev => prev.length === 1 ? prev : prev.filter(r => r.id !== rowId));
  };

  const addProductLine = (rowId: string) => {
    setFormRows(prev => prev.map(r => r.id !== rowId ? r : {
      ...r,
      items: [...r.items, createEmptyLine(`${rowId}-${Date.now()}`)],
    }));
  };

  const removeProductLine = (rowId: string, lineId: string) => {
    setFormRows(prev => prev.map(r => r.id !== rowId || r.items.length === 1 ? r : {
      ...r,
      items: r.items.filter(l => l.id !== lineId),
    }));
  };

  // Clone keeps every product line but resets the student's identity —
  // that must always be freshly scanned per person, never copied.
  const cloneRow = (rowId: string) => {
    const source = formRows.find(r => r.id === rowId);
    if (!source) return;
    const newRowId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const clone: LendingFormRow = {
      ...source,
      id: newRowId,
      studentIdCode: "",
      decoded: null,
      decodeError: null,
      studentName: "",
      items: source.items.map((l, i) => ({ ...l, id: `${newRowId}-${i}` })),
    };
    setFormRows(prev => [...prev, clone]);
  };

  const cloneRowNTimes = (rowId: string) => {
    const n = Number(cloneCount) || 0;
    if (n < 1) return;
    for (let i = 0; i < n; i++) cloneRow(rowId);
  };

  const checkStockForLine = async (rowId: string, lineId: string, productId: string, requestedQuantity: number) => {
    const key = `${rowId}:${lineId}`;
    try {
      const res = await authFetch(`/api/stocks/${productId}`);
      if (res.ok) {
        const data = await res.json();
        const availableStock = data.quantity || 0;
        if (requestedQuantity > availableStock) {
          setLineStockError(prev => ({ ...prev, [key]: `Insufficient stock. Available: ${availableStock}` }));
        } else {
          setLineStockError(prev => { const c = { ...prev }; delete c[key]; return c; });
        }
      }
    } catch (error) {
      console.error("Error checking stock:", error);
    }
  };

  const selectProductForLine = (rowId: string, lineId: string, product: Product) => {
    const row = formRows.find(r => r.id === rowId);
    const line = row?.items.find(l => l.id === lineId);
    mergeLine(rowId, lineId, {
      productId: product.product_id,
      productName: product.product_name,
      productQuery: product.product_name,
      // Fill the SKU in too — previously this got blanked back out right
      // after a successful SKU scan, which was the bug being fixed here.
      skuQuery: product.sku_code ?? "",
      // No per-product flag to infer this from anymore — RETURNABLE is the
      // default line type (matches createEmptyLine); switched per line via
      // the item-type dropdown below.
      itemType: "RETURNABLE",
    });
    setLineDropdown(null);
    checkStockForLine(rowId, lineId, product.product_id, Number(line?.quantity) || 1);
  };

  // Scan-to-fetch: a barcode scanner just types characters + Enter into
  // whichever input is focused — same pattern as the student-ID field.
  const handleSkuScan = async (rowId: string, lineId: string) => {
    const row = formRows.find(r => r.id === rowId);
    const line = row?.items.find(l => l.id === lineId);
    if (!line || !line.skuQuery.trim()) return;
    try {
      const res = await authFetch(`/api/products?sku=${encodeURIComponent(line.skuQuery.trim())}`);
      if (res.ok) {
        const product = await res.json();
        selectProductForLine(rowId, lineId, product);
      } else {
        mergeLine(rowId, lineId, { productId: "", productName: "" });
        setLineStockError(prev => ({ ...prev, [`${rowId}:${lineId}`]: "No product with that SKU" }));
      }
    } catch (error) {
      console.error("Error scanning SKU:", error);
    }
  };

  // Decode on Enter or once the scanner/typist has produced a full code —
  // works identically whether typed or scanned. Gated on the pure local
  // parse (not just a fixed length) since lateral-entry codes are 11
  // characters instead of the regular 10 — a plain length check would
  // either miss them or flash an "unrecognized" error for the 10-char
  // in-progress prefix.
  const handleStudentIdChange = (rowId: string, value: string) => {
    updateRow(rowId, "studentIdCode", value);
    if (decodeStudentIdCode(value.trim())) decodeStudentIdForRow(rowId, value);
  };

  // Jumps focus to the next row's Student ID field — the fast path for
  // filling in a batch of cloned rows (clone once, then just scan/type IDs
  // and keep advancing without touching the mouse). Bound to both Enter
  // (which also decodes) and F2 (pure jump, no decode) on the ID input.
  const focusNextStudentIdField = (currentRowId: string) => {
    const idx = formRows.findIndex((r) => r.id === currentRowId);
    if (idx === -1) return;
    const nextRow = formRows[idx + 1];
    if (!nextRow) return;
    const el = studentIdInputRefs.current.get(nextRow.id);
    if (el) { el.focus(); el.select(); }
  };

  const decodeStudentIdForRow = async (rowId: string, code: string) => {
    if (!code.trim()) return;
    try {
      const res = await authFetch("/api/students/decode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id_code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        mergeRow(rowId, { decoded: null, decodeError: extractErrorMessage(data, "Unrecognized student ID format") });
        return;
      }
      mergeRow(rowId, {
        decoded: {
          department_id: data.department_id,
          department_name: data.department_name,
          college_name: data.college_name,
          year_of_study: data.year_of_study,
          is_lateral_entry: !!data.is_lateral_entry,
          existing: data.existing,
          student_name: data.student_name,
        },
        decodeError: data.department_id ? null : (extractErrorMessage(data, "Unknown department code — check Admin Settings")),
        studentName: data.existing && data.student_name ? data.student_name : "",
      });
    } catch (error) {
      console.error("Error decoding student ID:", error);
      mergeRow(rowId, { decoded: null, decodeError: "Failed to decode — try again" });
    }
  };

  const resetForm = () => {
    setFormRows([createEmptyRow("1")]);
    setLendingDate(new Date().toISOString().split("T")[0]);
    setAdminDomainId("");
    setLineDropdown(null);
    setLineStockError({});
    setRowSubmitStatus({});
  };

  const lineDueDate = (line: LendingProductLine): string | null => {
    if (line.itemType === "CONSUMABLE") return null;
    return line.dueDateValue || null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    // A row is submittable once it has a scanned student ID and at least
    // one complete product line; incomplete lines within it are skipped,
    // not blocking — same "untouched rows don't block submit" philosophy
    // used on the Products page's 5-row form.
    const validRows = formRows
      .map(r => ({ ...r, items: r.items.filter(l => l.productId && Number(l.quantity) > 0) }))
      .filter(r => r.studentIdCode.trim() && r.items.length > 0);
    if (validRows.length === 0) {
      showToast("Add at least one complete row (scanned student ID + product + quantity).", "warning");
      return;
    }
    if (Object.keys(lineStockError).length > 0) {
      showToast("Please resolve stock availability issues before submitting.", "warning");
      return;
    }

    const domainId = appUser?.domain?.domain_id || adminDomainId || undefined;
    if (!domainId) {
      showToast("Select a COE domain/room before submitting.", "warning");
      return;
    }

    setIsSubmitting(true);
    let anyFailed = false;
    const statusUpdate: { [rowId: string]: "ok" | "error" } = {};

    // due_date lives on the order, not the item, so a row whose lines have
    // different item types/due dates can't collapse into one POST — group
    // each row's own lines by (itemType, dueDate) and submit one order per
    // group. The common case (one type/date per row) is still one call.
    for (const row of validRows) {
      const groups = new Map<string, LendingProductLine[]>();
      for (const line of row.items) {
        const key = `${line.itemType}|${line.itemType === "CONSUMABLE" ? "" : line.dueDateValue}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(line);
      }

      let rowFailed = false;
      for (const items of groups.values()) {
        try {
          const res = await authFetch("/api/lending", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              student_id_code: row.studentIdCode.trim(),
              student_name: row.studentName || undefined,
              lending_date: lendingDate,
              due_date: lineDueDate(items[0]),
              domain_id: domainId,
              lending_items: items.map(l => ({ product_id: l.productId, quantity: Number(l.quantity) || 1, item_type: l.itemType })),
            }),
          });
          if (!res.ok) rowFailed = true;
        } catch (error) {
          console.error("Error creating lending entry:", error);
          rowFailed = true;
        }
      }
      statusUpdate[row.id] = rowFailed ? "error" : "ok";
      if (rowFailed) anyFailed = true;
    }

    setRowSubmitStatus(statusUpdate);
    await fetchLendingRecords();
    setIsSubmitting(false);

    if (!anyFailed) {
      setIsModalOpen(false);
      resetForm();
    } else {
      showToast("Some rows failed — fix the highlighted rows and submit again.", "warning");
      // Keep only the failed rows so the user can fix and resubmit.
      setFormRows(prev => prev.filter(r => statusUpdate[r.id] === "error"));
    }
  };

  const handleReturnDateUpdate = async (recordId: number, productId: string | null, returnDate: string, returnQty?: number) => {
    const prevRecords = records;
    const existingRecord = records.find(r => r.id === recordId && r.product_id === productId);
    if (!existingRecord) return;

    // How many are still outstanding for this specific item after this return
    const currentOutstanding = existingRecord.quantity;
    const nowReturning = returnQty ?? currentOutstanding;
    const remaining = currentOutstanding - nowReturning;

    // Compute order-level status from ALL items in the same order after this return
    const orderRecords = records.filter(r => r.id === recordId);
    const totalOutstandingAfter = orderRecords.reduce(
      (sum, r) => sum + (r.product_id === productId ? remaining : (r.quantity || 0)),
      0
    );
    const anyDamagedInOrder = orderRecords.some(r => (r.damaged_quantity || 0) > 0);
    const anyLostInOrder = orderRecords.some(r => (r.lost_quantity || 0) > 0);

    let newOrderStatus: string;
    if (totalOutstandingAfter > 0) {
      const curStatus = existingRecord.status;
      if (curStatus === "PARTIALLY_DAMAGED" || curStatus === "DAMAGED") {
        newOrderStatus = "PARTIALLY_DAMAGED";
      } else if (curStatus === "PARTIALLY_LOST") {
        newOrderStatus = "PARTIALLY_LOST";
      } else {
        newOrderStatus = "PARTIALLY_RETURNED";
      }
    } else {
      if (anyDamagedInOrder) {
        newOrderStatus = "RETURNED_DAMAGED";
      } else if (anyLostInOrder) {
        newOrderStatus = "RETURNED_LOST";
      } else {
        newOrderStatus = "RETURNED";
      }
    }

    // Update ALL rows in this order with the new order-level status;
    // update only this specific item's quantity and return_date
    const updated = records.map(r => {
      if (r.id !== recordId) return r;
      if (r.product_id === productId) {
        return { ...r, quantity: remaining, status: newOrderStatus, return_date: returnDate };
      }
      return { ...r, status: newOrderStatus };
    });
    setRecords(updated);
    applyStats(updated);
    setEditingReturnDate(null);
    setReturnPickerRowIdx(null);
    setReturnPickerDate("");
    setReturnPickerQty(1);
    try {
      // Send remaining balance + product_id so the backend updates only this item
      const body: any = { return_date: returnDate, quantity: remaining, product_id: productId };
      const res = await authFetch(`/api/lending/${recordId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setRecords(prevRecords);
        applyStats(prevRecords);
        console.error("Failed to update return date:", res.status);
        showToast("Couldn't record the return. Please try again.", "error");
      }
    } catch (error) {
      setRecords(prevRecords);
      applyStats(prevRecords);
      console.error("Error updating return date:", error);
      showToast("Couldn't record the return. Please check your connection and try again.", "error");
    }
  };

  const exportPDF = () => {
   try {
    const doc = new jsPDF({ orientation: 'landscape' });
    const extractDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Lending Data', 14, 16);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Extracted on: ${extractDate}`, 14, 23);
    const head = [['S.No', 'Student', 'Student ID', 'Dept', 'Domain/Room', 'Product', 'Item Type', 'Borrowed', 'Returned', 'Damaged', 'Lost', 'Balance', 'Lent Date', 'Due Date', 'Return Date', 'Status']];
    const FULLY_RETURNED_STATUSES = ['RETURNED', 'RETURNED_DAMAGED', 'RETURNED_LOST'];
    const body = filteredRecords.map((record, i) => {
      const borrowed = record.original_quantity ?? record.quantity;
      const damaged = record.damaged_quantity ?? 0;
      const lost = record.lost_quantity ?? 0;
      const currentQty = record.quantity;
      const isFullyReturned = FULLY_RETURNED_STATUSES.includes(record.status);
      const retd = isFullyReturned
        ? Math.max(0, borrowed - damaged - lost)
        : Math.max(0, borrowed - currentQty - damaged - lost);
      const balance = isFullyReturned ? 0 : currentQty;
      return [
        i + 1,
        record.borrower_name || '—',
        record.student_id_code || '—',
        record.department || '—',
        `${record.domain_name}${record.room_name !== '—' ? ' / ' + record.room_name : ''}`,
        record.product_name || '—',
        record.item_type || '—',
        borrowed,
        retd > 0 ? retd : '—',
        damaged > 0 ? damaged : '—',
        lost > 0 ? lost : '—',
        balance > 0 ? balance : '—',
        formatDate(record.lending_date),
        formatDate(record.due_date),
        formatDate(record.return_date),
        record.status || '—',
      ];
    });
    autoTable(doc, {
      head,
      body,
      startY: 28,
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [30, 41, 56], textColor: 255, fontStyle: 'bold', fontSize: 7 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
    });
    doc.save(`lending-data-${new Date().toISOString().split('T')[0]}.pdf`);
   } catch (err) {
    console.error('[lending] PDF export failed:', err);
    showToast("Couldn't generate the PDF. Please try again.", 'error');
   }
  };

  const exportExcel = () => {
   try {
    const FULLY_RETURNED_STATUSES = ['RETURNED', 'RETURNED_DAMAGED', 'RETURNED_LOST'];
    const data = filteredRecords.map((record, i) => {
      const borrowed = record.original_quantity ?? record.quantity;
      const damaged = record.damaged_quantity ?? 0;
      const lost = record.lost_quantity ?? 0;
      const currentQty = record.quantity;
      const isFullyReturned = FULLY_RETURNED_STATUSES.includes(record.status);
      const retd = isFullyReturned
        ? Math.max(0, borrowed - damaged - lost)
        : Math.max(0, borrowed - currentQty - damaged - lost);
      const balance = isFullyReturned ? 0 : currentQty;
      return {
        'S.No': i + 1,
        'Student': record.borrower_name || '',
        'Student ID': record.student_id_code || '',
        'Department': record.department || '',
        'Domain/Room': `${record.domain_name}${record.room_name !== '—' ? ' / ' + record.room_name : ''}`,
        'Product': record.product_name || '',
        'Item Type': record.item_type || '',
        'Borrowed': borrowed,
        'Returned': retd > 0 ? retd : '',
        'Damaged': damaged > 0 ? damaged : '',
        'Lost': lost > 0 ? lost : '',
        'Balance': balance > 0 ? balance : '',
        'Lent Date': formatDate(record.lending_date),
        'Due Date': formatDate(record.due_date),
        'Return Date': formatDate(record.return_date),
        'Status': record.status || '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Lending Data');
    XLSX.writeFile(wb, `lending-data-${new Date().toISOString().split('T')[0]}.xlsx`);
   } catch (err) {
    console.error('[lending] Excel export failed:', err);
    showToast("Couldn't generate the spreadsheet. Please try again.", 'error');
   }
  };

  // The per-item row — used both for a single-item group (identical to the
  // page's original row-per-record behavior) and for each item revealed
  // when a multi-item group is expanded, where identity columns are left
  // blank (the summary row above already shows them) and the product name
  // is indented to read as a sub-row.
  function renderItemRow(record: LendingRecord, flatIdx: number, groupIdx: number, nested: boolean) {
    return (
      <tr key={`${record.id}-${record.product_id ?? 'none'}-${flatIdx}`} style={{ border: '1px solid #E5E7EB', background: nested ? 'var(--surface)' : undefined }}>
        <td style={{ padding: '7px 10px' }}></td>
        <td style={{ padding: '7px 10px', color: 'var(--muted)' }}>{nested ? '' : groupIdx + 1}</td>
        <td style={{ padding: '7px 10px', color: 'var(--fg)', whiteSpace: 'nowrap' }}>{nested ? '' : (record.borrower_name || '—')}</td>
        <td style={{ padding: '7px 10px', color: 'var(--fg)', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 11 }}>{nested ? '' : (record.student_id_code || '—')}</td>
        <td style={{ padding: '7px 10px', color: 'var(--fg)' }}>{nested ? '' : (record.department_code || record.department || '—')}</td>
        <td style={{ padding: '7px 10px', color: 'var(--fg)', whiteSpace: 'nowrap' }}>{nested ? '' : `${record.domain_name}${record.room_name !== '—' ? ` / ${record.room_name}` : ''}`}</td>
        <td style={{ padding: '7px 10px', maxWidth: 220 }}>
          <div style={{ overflowX: 'auto', whiteSpace: 'nowrap', color: 'var(--fg)', paddingLeft: nested ? 22 : undefined }} title={record.product_name || undefined}>
            {record.product_name || '—'}
          </div>
        </td>
        <td style={{ padding: '7px 10px' }}>
          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', background: record.item_type === 'RETURNABLE' ? '#dbeafe' : '#ede9fe', color: record.item_type === 'RETURNABLE' ? '#1e40af' : '#6d28d9', letterSpacing: '0.04em' }}>
            {record.item_type || '—'}
          </span>
        </td>
        {/* Quantity breakdown */}
        {(() => {
          const c = computeItemCounts(record);
          const qCell = (v: number, color: string) => (
            <td style={{ padding: '7px 10px', textAlign: 'center', color: v > 0 ? color : 'var(--muted)', fontWeight: v > 0 ? 600 : 400 }}>{v > 0 ? v : '—'}</td>
          );
          return (
            <>
              <td style={{ padding: '7px 10px', textAlign: 'center', color: 'var(--fg)' }}>
                {editingRow === flatIdx ? (
                  <input
                    type="number" min="1"
                    value={editQtyStr}
                    onChange={(e) => setEditQtyStr(e.target.value)}
                    style={{ width: 52, padding: '2px 6px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)' }}
                  />
                ) : c.borrowed}
              </td>
              {qCell(c.retd, '#16a34a')}
              {qCell(c.damaged, '#dc2626')}
              {qCell(c.lost, '#d97706')}
              {qCell(c.balance, '#92400e')}
            </>
          );
        })()}
        <td style={{ padding: '7px 10px', color: 'var(--fg)', whiteSpace: 'nowrap' }}>{formatDate(record.lending_date)}</td>
        <td style={{ padding: '7px 10px', color: 'var(--fg)', whiteSpace: 'nowrap' }}>
          {editingRow === flatIdx ? (
            <input
              type="date"
              value={editFormData.due_date || record.due_date || ''}
              onChange={(e) => setEditFormData({ ...editFormData, due_date: e.target.value })}
              style={{ padding: '2px 6px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)' }}
            />
          ) : formatDate(record.due_date)}
        </td>
        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
          {record.return_date ? (
            <span style={{ color: 'var(--fg)' }}>{formatDate(record.return_date)}</span>
          ) : record.status === 'CONSUMABLE' ? (
            <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>
          ) : (
            <button
              onClick={() => { setReturnPickerRowIdx(flatIdx); setReturnPickerDate(new Date().toISOString().split('T')[0]); setReturnPickerQty(record.quantity); }}
              title="Set return date"
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, textDecoration: 'underline', padding: 0 }}
            >
              Set Date
            </button>
          )}
        </td>
        <td className="sticky-col" style={{ padding: '7px 10px', right: ACTIONS_COL_WIDTH, width: STATUS_COL_WIDTH, background: nested ? 'var(--surface)' : '#fff' }}>
          {(['PENDING', 'PARTIALLY_RETURNED', 'PARTIALLY_DAMAGED', 'PARTIALLY_LOST'].includes(record.status)) ? (
            <select
              value={record.status}
              onChange={(e) => {
                if (e.target.value === 'DO_DAMAGED') { setDamagedRowIdx(flatIdx); setDamagedQtyStr('1'); }
                else if (e.target.value === 'DO_LOST') { setLostRowIdx(flatIdx); setLostQtyStr('1'); }
                else if (e.target.value === 'DO_RETURN') { setReturnPickerRowIdx(flatIdx); setReturnPickerDate(new Date().toISOString().split('T')[0]); setReturnPickerQty(record.quantity); }
              }}
              className="dropdown-control"
              style={{ fontSize: 12, fontWeight: 600, padding: '6px 10px', border: '1px solid var(--border)', background: '#fff', color: 'var(--fg)', cursor: 'pointer', width: '100%', maxWidth: STATUS_COL_WIDTH - 20, boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              <option value={record.status}>
                {record.status === 'PENDING' ? 'PENDING'
                  : record.status === 'PARTIALLY_RETURNED' ? 'PARTIALLY RETURNED'
                  : record.status === 'PARTIALLY_DAMAGED' ? 'PARTIALLY DAMAGED'
                  : 'PARTIALLY LOST'}
              </option>
              <option value="DO_RETURN">Mark as Returned</option>
              <option value="DO_DAMAGED">Mark as Damaged</option>
              <option value="DO_LOST">Mark as Lost</option>
            </select>
          ) : (
            (() => {
              const isConsumable = record.status === 'CONSUMABLE';
              if (isConsumable) {
                return (
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: '#ede9fe', color: '#6d28d9' }}>
                    CONSUMABLE
                  </span>
                );
              }
              const d = record.damaged_quantity ?? 0;
              const l = record.lost_quantity ?? 0;
              const orig = (record.original_quantity != null && record.original_quantity > 0) ? record.original_quantity : record.quantity;
              const returnedCount = Math.max(0, orig - d - l);
              const hasPills = returnedCount > 0 || d > 0 || l > 0;
              if (hasPills) {
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {returnedCount > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: '#dcfce7', color: '#166534', whiteSpace: 'nowrap' }}>{returnedCount} Returned</span>
                    )}
                    {d > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: '#fee2e2', color: '#991b1b', whiteSpace: 'nowrap' }}>{d} Damaged</span>
                    )}
                    {l > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: '#fef3c7', color: '#92400e', whiteSpace: 'nowrap' }}>{l} Lost</span>
                    )}
                  </div>
                );
              }
              return (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: 'var(--surface)', color: 'var(--muted)' }}>
                  {record.status || '—'}
                </span>
              );
            })()
          )}
        </td>
        <td className="sticky-col" style={{ padding: '7px 10px', right: 0, width: ACTIONS_COL_WIDTH, background: nested ? 'var(--surface)' : '#fff' }}>
          {editingRow === flatIdx ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={handleSaveEdit} style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, background: '#16a34a', color: '#fff', border: 'none', cursor: 'pointer' }}>Save</button>
              <button onClick={handleCancelEdit} style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, background: 'var(--surface)', color: 'var(--fg)', border: '1px solid var(--border)', cursor: 'pointer' }}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => handleEdit(record, flatIdx)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Edit</button>
              <button onClick={() => handleDelete(record.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Del</button>
            </div>
          )}
        </td>
      </tr>
    );
  }

  if (loading) return (
    <div style={{ padding: 32, color: 'var(--muted)', fontSize: 13 }}>Loading lending records...</div>
  );

  return (
    <div style={{ maxWidth: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Entry</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Track and manage all borrowing records</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value)}
            style={{ padding: '5px 10px', fontSize: 12, border: '1px solid var(--border)', background: '#fff', color: 'var(--fg)', cursor: 'pointer' }}
          >
            <option>Daily</option>
            <option>Weekly</option>
            <option>Monthly</option>
            <option>Yearly</option>
          </select>
          <button
            onClick={() => setIsModalOpen(true)}
            style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            + Add Entry
          </button>
          {/* Export split button */}
          <div ref={exportDropdownRef} style={{ position: 'relative', display: 'flex' }}>
            <button
              onClick={() => { exportExcel(); setShowExportDropdown(false); }}
              style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, background: '#fff', color: 'var(--fg)', border: '1px solid var(--border)', borderRight: 'none', cursor: 'pointer' }}
            >
              Export
            </button>
            <button
              onClick={() => setShowExportDropdown(d => !d)}
              style={{ padding: '5px 8px', fontSize: 12, background: '#fff', color: 'var(--fg)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              title="More export options"
            >
              ▾
            </button>
            {showExportDropdown && (
              <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 20, background: '#fff', border: '1px solid var(--border)', minWidth: 150, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                <button
                  onClick={() => { exportExcel(); setShowExportDropdown(false); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', fontSize: 12, background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', color: 'var(--fg)' }}
                >
                  Export Excel
                </button>
                <button
                  onClick={() => { exportPDF(); setShowExportDropdown(false); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg)' }}
                >
                  Export PDF
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', border: '1px solid var(--border)', marginBottom: 20, background: '#fff' }}>
        {[
          { label: 'Total Lent', value: `${totalLent} (${totalQuantity})` },
          { label: 'Returned', value: returned },
          { label: 'Pending', value: pending },
        ].map((s, i) => (
          <div key={i} style={{ padding: '14px 18px', borderRight: i < 2 ? '1px solid var(--border)' : 'none' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--fg)', marginTop: 4 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} style={selectStyle} className="dropdown-control">
          <option value="">All Departments</option>
          {departments.map(d => <option key={d.department_id} value={d.department_name}>{d.code || d.department_name}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selectStyle} className="dropdown-control">
          <option value="">All Status</option>
          <option value="PENDING">Pending</option>
          <option value="CONSUMABLE">Consumable</option>
          <option value="RETURNED">Returned</option>
          <option value="DAMAGED">Damaged</option>
          <option value="LOST">Lost</option>
        </select>
        <select value={productFilter} onChange={e => setProductFilter(e.target.value)} style={selectStyle} className="dropdown-control">
          <option value="">All Products</option>
          {uniqueProducts.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={itemTypeFilter} onChange={e => setItemTypeFilter(e.target.value)} style={selectStyle} className="dropdown-control">
          <option value="">All Item Types</option>
          <option value="RETURNABLE">Returnable</option>
          <option value="CONSUMABLE">Consumable</option>
        </select>
        <input
          type="text"
          placeholder="Search by name, student ID, product, department..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: 1, minWidth: 180, padding: '5px 10px', fontSize: 12, border: '1px solid var(--border)', color: 'var(--fg)', background: '#fff', outline: 'none' }}
        />
        {(deptFilter || statusFilter || productFilter || itemTypeFilter || searchQuery) && (
          <button
            onClick={() => { setDeptFilter(''); setStatusFilter(''); setProductFilter(''); setItemTypeFilter(''); setSearchQuery(''); }}
            style={{ padding: '5px 10px', fontSize: 11, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--muted)', cursor: 'pointer' }}
          >Clear</button>
        )}
      </div>

      {/* Table */}
      <div style={{ background: '#fff', border: '1px solid var(--border)', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1, minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }} className="[&_td]:border [&_td]:border-[#E5E7EB]">
          <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface)' }}>
            <tr style={{ background: 'var(--surface)' }}>
              <th style={{ padding: '6px 10px', border: '1px solid #E5E7EB', width: 40 }}></th>
              {['S.No', 'Student', 'Student ID', 'Dept', 'Domain/Room', 'Product', 'Item Type'].map((h) => (
                <th key={h} style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', border: '1px solid #E5E7EB', textAlign: 'left', whiteSpace: 'nowrap', userSelect: 'none' }}>{h}</th>
              ))}
              <th onClick={() => handleSort('original_quantity')} style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', border: '1px solid #E5E7EB', textAlign: 'left', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>Borrowed <SortIcon col="original_quantity" /></span></th>
              {['Returned', 'Damaged', 'Lost', 'Balance'].map((h) => (
                <th key={h} style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', border: '1px solid #E5E7EB', textAlign: 'left', whiteSpace: 'nowrap', userSelect: 'none' }}>{h}</th>
              ))}
              <th onClick={() => handleSort('lending_date')} style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', border: '1px solid #E5E7EB', textAlign: 'left', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>Lent Date <SortIcon col="lending_date" /></span></th>
              <th onClick={() => handleSort('due_date')} style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', border: '1px solid #E5E7EB', textAlign: 'left', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>Due Date <SortIcon col="due_date" /></span></th>
              <th onClick={() => handleSort('return_date')} style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', border: '1px solid #E5E7EB', textAlign: 'left', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>Return Date <SortIcon col="return_date" /></span></th>
              <th className="sticky-col" style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', border: '1px solid #E5E7EB', textAlign: 'left', whiteSpace: 'nowrap', userSelect: 'none', right: ACTIONS_COL_WIDTH, width: STATUS_COL_WIDTH, background: 'var(--surface)' }}>Status</th>
              <th className="sticky-col" style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', border: '1px solid #E5E7EB', textAlign: 'left', whiteSpace: 'nowrap', userSelect: 'none', right: 0, width: ACTIONS_COL_WIDTH, background: 'var(--surface)' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecords.length === 0 ? (
              <tr>
                <td colSpan={18} style={{ padding: '32px 10px', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>No lending records found</td>
              </tr>
            ) : (
              padRows.map((group, localIdx) => {
                if (!group) {
                  return (
                    <tr key={`empty-${localIdx}`}>
                      <td style={{ padding: '7px 10px', border: 'none' }} colSpan={18}>&nbsp;</td>
                    </tr>
                  );
                }
                const groupIdx = showAll ? localIdx : startIdx + localIdx;

                if (group.records.length === 1) {
                  const record = group.records[0];
                  return renderItemRow(record, filteredRecords.indexOf(record), groupIdx, false);
                }

                const isExpanded = expandedKeys.has(group.key);
                const agg = group.records.reduce((a, r) => {
                  const c = computeItemCounts(r);
                  return { borrowed: a.borrowed + c.borrowed, retd: a.retd + c.retd, damaged: a.damaged + c.damaged, lost: a.lost + c.lost, balance: a.balance + c.balance };
                }, { borrowed: 0, retd: 0, damaged: 0, lost: 0, balance: 0 });
                const first = group.records[0];
                const allDueDatesMatch = group.records.every((r) => r.due_date === first.due_date);
                const allReturnDatesMatch = group.records.every((r) => r.return_date === first.return_date);
                const allSameItemType = group.records.every((r) => r.item_type === first.item_type);
                const qCell = (v: number, color: string) => (
                  <td style={{ padding: '7px 10px', textAlign: 'center', color: v > 0 ? color : 'var(--muted)', fontWeight: v > 0 ? 600 : 400 }}>{v > 0 ? v : '—'}</td>
                );

                return (
                  <Fragment key={group.key}>
                    <tr style={{ border: '1px solid #E5E7EB', background: isExpanded ? 'var(--surface)' : undefined }}>
                      <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                        <button
                          onClick={() => toggleExpanded(group.key)}
                          title={isExpanded ? 'Collapse' : `Show ${group.records.length} items`}
                          className="row-toggle-btn"
                        >
                          {isExpanded ? '▾' : '▸'}
                        </button>
                      </td>
                      <td style={{ padding: '7px 10px', color: 'var(--muted)' }}>{groupIdx + 1}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--fg)', whiteSpace: 'nowrap' }}>{first.borrower_name || '—'}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--fg)', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 11 }}>{first.student_id_code || '—'}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--fg)' }}>{first.department_code || first.department || '—'}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--fg)', whiteSpace: 'nowrap' }}>{first.domain_name}{first.room_name !== '—' ? ` / ${first.room_name}` : ''}</td>
                      <td style={{ padding: '7px 10px', maxWidth: 220 }}>
                        <div style={{ overflowX: 'auto', whiteSpace: 'nowrap', color: 'var(--fg)' }} title={group.records.map((r) => r.product_name).join(', ')}>
                          {group.records.length} items ({group.records.map((r) => r.product_name).filter(Boolean).join(', ')})
                        </div>
                      </td>
                      <td style={{ padding: '7px 10px' }}>
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', background: 'var(--surface)', color: 'var(--muted)', letterSpacing: '0.04em' }}>
                          {allSameItemType ? (first.item_type || '—') : 'MIXED'}
                        </span>
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'center', color: 'var(--fg)' }}>{agg.borrowed}</td>
                      {qCell(agg.retd, '#16a34a')}
                      {qCell(agg.damaged, '#dc2626')}
                      {qCell(agg.lost, '#d97706')}
                      {qCell(agg.balance, '#92400e')}
                      <td style={{ padding: '7px 10px', color: 'var(--fg)', whiteSpace: 'nowrap' }}>{formatDate(group.date)}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--fg)', whiteSpace: 'nowrap' }}>{allDueDatesMatch ? formatDate(first.due_date) : 'Multiple'}</td>
                      <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{allReturnDatesMatch ? formatDate(first.return_date) : 'Multiple'}</td>
                      <td className="sticky-col" style={{ padding: '7px 10px', right: ACTIONS_COL_WIDTH, width: STATUS_COL_WIDTH, background: isExpanded ? 'var(--surface)' : '#fff' }}>
                        {agg.retd > 0 || agg.damaged > 0 || agg.lost > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {agg.retd > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: '#dcfce7', color: '#166534', whiteSpace: 'nowrap' }}>{agg.retd} Returned</span>}
                            {agg.damaged > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: '#fee2e2', color: '#991b1b', whiteSpace: 'nowrap' }}>{agg.damaged} Damaged</span>}
                            {agg.lost > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: '#fef3c7', color: '#92400e', whiteSpace: 'nowrap' }}>{agg.lost} Lost</span>}
                            {agg.balance > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: 'var(--surface)', color: 'var(--muted)' }}>{agg.balance} Pending</span>}
                          </div>
                        ) : (
                          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: 'var(--surface)', color: 'var(--muted)' }}>PENDING</span>
                        )}
                      </td>
                      <td className="sticky-col" style={{ padding: '7px 10px', right: 0, width: ACTIONS_COL_WIDTH, background: isExpanded ? 'var(--surface)' : '#fff' }}></td>
                    </tr>
                    {isExpanded && group.records.map((record) => renderItemRow(record, filteredRecords.indexOf(record), groupIdx, true))}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
        </div>

        {/* Pagination */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            {showAll
              ? `Showing all ${sortedGroups.length} entries`
              : `Showing ${sortedGroups.length === 0 ? 0 : startIdx + 1}–${Math.min(startIdx + 50, sortedGroups.length)} of ${sortedGroups.length}`}
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} showAll={showAll} onToggleShowAll={setShowAll} />
        </div>
      </div>

      {/* Return Date Modal */}
      {returnPickerRowIdx !== null && filteredRecords[returnPickerRowIdx] && (() => {
        const rec = filteredRecords[returnPickerRowIdx];
        const isPartiallyDamaged = rec.status === 'PARTIALLY_DAMAGED';
        const isPartiallyLost = rec.status === 'PARTIALLY_LOST';
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}>
            <div style={{ background: '#fff', border: '1px solid var(--border)', padding: 24, width: 360, maxWidth: '90vw' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>Set Return Date</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>Product: <strong style={{ color: 'var(--fg)' }}>{rec.product_name}</strong></div>
              {isPartiallyDamaged && (
                <div style={{ fontSize: 11, color: '#991b1b', background: '#fee2e2', padding: '6px 10px', marginBottom: 12 }}>
                  {rec.damaged_quantity ?? 0} item{(rec.damaged_quantity ?? 0) !== 1 ? 's were' : ' was'} damaged. Returning the remaining {rec.quantity} item{rec.quantity !== 1 ? 's' : ''} → status will be Returned (Damaged).
                </div>
              )}
              {isPartiallyLost && (
                <div style={{ fontSize: 11, color: '#92400e', background: '#fef3c7', padding: '6px 10px', marginBottom: 12 }}>
                  {rec.lost_quantity ?? 0} item{(rec.lost_quantity ?? 0) !== 1 ? 's were' : ' was'} lost. Returning the remaining {rec.quantity} item{rec.quantity !== 1 ? 's' : ''} → status will be Returned (Lost).
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Return Date</div>
                  <input type="date" value={returnPickerDate} max={new Date().toISOString().split('T')[0]} onChange={(e) => setReturnPickerDate(e.target.value)}
                    style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', boxSizing: 'border-box' as const }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Qty Returned (max {rec.quantity})</div>
                  <input type="number" min={1} max={rec.quantity} value={returnPickerQty} onChange={(e) => setReturnPickerQty(Math.min(rec.quantity, Math.max(1, parseInt(e.target.value) || 1)))}
                    style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', boxSizing: 'border-box' as const }} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={() => { setReturnPickerRowIdx(null); setReturnPickerDate(''); setReturnPickerQty(1); }} disabled={returnPickerLoading}
                  style={{ padding: '5px 14px', fontSize: 12, border: '1px solid var(--border)', background: '#fff', color: 'var(--fg)', cursor: 'pointer' }}>Cancel</button>
                <button
                  onClick={async () => { if (!returnPickerDate) { showToast('Please select a return date.', 'warning'); return; } setReturnPickerLoading(true); await handleReturnDateUpdate(rec.id, rec.product_id, returnPickerDate, returnPickerQty); setReturnPickerLoading(false); }}
                  disabled={returnPickerLoading || !returnPickerDate}
                  style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, background: '#16a34a', color: '#fff', border: 'none', cursor: 'pointer', opacity: returnPickerLoading || !returnPickerDate ? 0.5 : 1 }}>
                  {returnPickerLoading ? 'Saving...' : 'Confirm Return'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Damage Modal */}
      {damagedRowIdx !== null && filteredRecords[damagedRowIdx] && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}>
          <div style={{ background: '#fff', border: '1px solid var(--border)', padding: 24, width: 360, maxWidth: '90vw' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>Mark Items as Damaged</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 16 }}>
              Product: <strong style={{ color: 'var(--fg)' }}>{filteredRecords[damagedRowIdx].product_name}</strong><br />
              Lent qty: <strong style={{ color: 'var(--fg)' }}>{filteredRecords[damagedRowIdx].quantity}</strong>
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Number of Damaged Items</div>
            <input type="number" min={1} max={filteredRecords[damagedRowIdx].quantity} value={damagedQtyStr} onChange={(e) => setDamagedQtyStr(e.target.value)}
              style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', marginBottom: 16, boxSizing: 'border-box' as const }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => { setDamagedRowIdx(null); setDamagedQtyStr('1'); }} disabled={damageLoading}
                style={{ padding: '5px 14px', fontSize: 12, border: '1px solid var(--border)', background: '#fff', color: 'var(--fg)', cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => handleMarkDamaged(filteredRecords[damagedRowIdx]!)} disabled={damageLoading}
                style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', opacity: damageLoading ? 0.5 : 1 }}>
                {damageLoading ? 'Saving...' : 'Confirm Damaged'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lost Modal */}
      {lostRowIdx !== null && filteredRecords[lostRowIdx] && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}>
          <div style={{ background: '#fff', border: '1px solid var(--border)', padding: 24, width: 360, maxWidth: '90vw' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>Mark Items as Lost</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 16 }}>
              Product: <strong style={{ color: 'var(--fg)' }}>{filteredRecords[lostRowIdx].product_name}</strong><br />
              Lent qty: <strong style={{ color: 'var(--fg)' }}>{filteredRecords[lostRowIdx].quantity}</strong>
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Number of Lost Items</div>
            <input type="number" min={1} max={filteredRecords[lostRowIdx].quantity} value={lostQtyStr} onChange={(e) => setLostQtyStr(e.target.value)}
              style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', marginBottom: 16, boxSizing: 'border-box' as const }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => { setLostRowIdx(null); setLostQtyStr('1'); }} disabled={lostLoading}
                style={{ padding: '5px 14px', fontSize: 12, border: '1px solid var(--border)', background: '#fff', color: 'var(--fg)', cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => handleMarkLost(filteredRecords[lostRowIdx]!)} disabled={lostLoading}
                style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, background: '#d97706', color: '#fff', border: 'none', cursor: 'pointer', opacity: lostLoading ? 0.5 : 1 }}>
                {lostLoading ? 'Saving...' : 'Confirm Lost'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Entry Modal */}
      {isModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', overflowY: 'auto', padding: '32px 16px' }}>
          <div style={{ background: '#fff', border: '1px solid var(--border)', padding: 24, width: '100%', maxWidth: 1240 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Add New Entry</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Lending Date</div>
                  <input type="date" required value={lendingDate} onChange={(e) => setLendingDate(e.target.value)}
                    style={{ padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)' }} />
                </div>
                <button onClick={() => { setIsModalOpen(false); resetForm(); }} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
              </div>
            </div>

            <form onSubmit={handleSubmit}>
              {/* Shared context: domain/room */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Domain / Room</div>
                {appUser?.domain ? (
                  <div style={{ padding: '5px 10px', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, color: 'var(--fg)', display: 'inline-block' }}>
                    {appUser.domain.domain_name} — {appUser.domain.room_name}
                  </div>
                ) : (
                  <select required value={adminDomainId} onChange={(e) => setAdminDomainId(e.target.value)}
                    style={{ padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', background: '#fff', minWidth: 220 }}>
                    <option value="">Select COE domain/room…</option>
                    {coeDomains.map((d) => (
                      <option key={d.domain_id} value={d.domain_id}>{d.domain_name} — {d.room_name}</option>
                    ))}
                  </select>
                )}
                {!appUser?.domain && (
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Your account has no COE domain — pick one for this batch.</div>
                )}
              </div>

              {/* Student rows (cards), each with one or more product lines */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '52vh', overflowY: 'auto', paddingRight: 4, marginBottom: 12 }}>
                {formRows.map((row, index) => {
                  const submitState = rowSubmitStatus[row.id];
                  return (
                    <div key={row.id} style={{
                      border: submitState === 'error' ? '1px solid #dc2626' : '1px solid var(--border)',
                      background: index % 2 === 0 ? '#fff' : 'var(--surface)',
                      padding: 10,
                    }}>
                      {/* Card header: S.No, Student ID, Student Name, row actions */}
                      <div style={{ display: 'grid', gridTemplateColumns: '30px 150px 1fr auto', gap: 8, alignItems: 'start', marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)', paddingTop: 5 }}>{index + 1}</div>
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 2 }}>Student ID (scan)</div>
                          <input
                            ref={(el) => { if (el) studentIdInputRefs.current.set(row.id, el); else studentIdInputRefs.current.delete(row.id); }}
                            type="text"
                            autoFocus={index === 0}
                            placeholder="e.g. sit21cs025"
                            value={row.studentIdCode}
                            onChange={(e) => handleStudentIdChange(row.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); decodeStudentIdForRow(row.id, row.studentIdCode); focusNextStudentIdField(row.id); }
                              else if (e.key === 'F2') { e.preventDefault(); focusNextStudentIdField(row.id); }
                            }}
                            style={{ width: '100%', padding: '4px 6px', fontSize: 11, border: row.decodeError ? '1px solid #dc2626' : '1px solid var(--border)', boxSizing: 'border-box' as const, fontFamily: 'monospace' }}
                            title="Enter: decode and next row · F2: skip to next row"
                          />
                          {row.decoded?.department_name && (
                            <div style={{ fontSize: 9, color: 'var(--accent)', marginTop: 2 }}>
                              {row.decoded.department_name}{row.decoded.existing ? ' · on file' : ' · new'}{row.decoded.is_lateral_entry ? ' · Lateral Entry' : ''}
                            </div>
                          )}
                          {row.decodeError && <div style={{ fontSize: 9, color: '#dc2626', marginTop: 2 }}>{row.decodeError}</div>}
                        </div>
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 2 }}>Student Name</div>
                          <input
                            type="text"
                            placeholder="Optional"
                            value={row.studentName}
                            disabled={!!(row.decoded?.existing && row.decoded.student_name)}
                            onChange={(e) => updateRow(row.id, 'studentName', e.target.value)}
                            style={{ width: '100%', padding: '4px 6px', fontSize: 11, border: '1px solid var(--border)', boxSizing: 'border-box' as const, background: (row.decoded?.existing && row.decoded.student_name) ? 'var(--surface)' : '#fff' }}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: 4, paddingTop: 16 }}>
                          <button type="button" onClick={() => cloneRow(row.id)} title="Clone row"
                            style={{ padding: '4px 6px', fontSize: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--accent)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            Clone
                          </button>
                          <button type="button" onClick={() => removeRow(row.id)} disabled={formRows.length === 1}
                            style={{ padding: '4px 6px', fontSize: 10, border: '1px solid var(--border)', background: formRows.length === 1 ? 'var(--surface)' : '#fff', color: formRows.length === 1 ? 'var(--muted)' : '#dc2626', cursor: formRows.length === 1 ? 'not-allowed' : 'pointer' }}>
                            ×
                          </button>
                        </div>
                      </div>

                      {/* Product line header */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 60px 110px 120px 90px 30px', gap: 6, marginBottom: 4 }}>
                        {['Product (search)', 'or Scan SKU', 'Qty', 'Type', 'Due Date', 'Due (days)', ''].map((h) => (
                          <div key={h} style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>{h}</div>
                        ))}
                      </div>

                      {/* Product lines */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {row.items.map((line) => {
                          const lineKey = `${row.id}:${line.id}`;
                          const lineProducts = line.productQuery
                            ? products.filter(p => p.product_name?.toLowerCase().includes(line.productQuery.toLowerCase()))
                            : [];
                          const daysDisplay = dueDateToDays(line.dueDateValue);
                          return (
                            <div key={line.id} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 60px 110px 120px 90px 30px', gap: 6, alignItems: 'start' }}>
                              {/* Product name search */}
                              <div>
                                <input
                                  ref={(el) => { if (el) productInputRefs.current.set(line.id, el); else productInputRefs.current.delete(line.id); }}
                                  type="text"
                                  placeholder="Type to search…"
                                  value={line.productQuery}
                                  onChange={(e) => { updateLine(row.id, line.id, 'productQuery', e.target.value); setLineDropdown({ rowId: row.id, lineId: line.id }); }}
                                  onFocus={() => setLineDropdown({ rowId: row.id, lineId: line.id })}
                                  style={{ width: '100%', padding: '4px 6px', fontSize: 11, border: '1px solid var(--border)', boxSizing: 'border-box' as const }}
                                />
                                {line.productName && <div style={{ fontSize: 9, color: 'var(--accent)', marginTop: 2 }}>{line.productName}</div>}
                                <ProductSearchDropdown
                                  anchorEl={productInputRefs.current.get(line.id) ?? null}
                                  open={lineDropdown?.rowId === row.id && lineDropdown.lineId === line.id}
                                  products={lineProducts}
                                  onSelect={(product) => selectProductForLine(row.id, line.id, product as Product)}
                                />
                              </div>

                              {/* Scan SKU */}
                              <input
                                type="text"
                                placeholder="Scan barcode…"
                                value={line.skuQuery}
                                onChange={(e) => updateLine(row.id, line.id, 'skuQuery', e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSkuScan(row.id, line.id); } }}
                                style={{ padding: '4px 6px', fontSize: 11, border: '1px solid var(--border)', boxSizing: 'border-box' as const, fontFamily: 'monospace' }}
                              />

                              {/* Qty */}
                              <div>
                                <input
                                  type="number" min={1}
                                  value={line.quantity}
                                  onChange={(e) => {
                                    const v = e.target.value === '' ? '' : Number(e.target.value);
                                    updateLine(row.id, line.id, 'quantity', v);
                                    if (line.productId && v !== '') checkStockForLine(row.id, line.id, line.productId, Number(v));
                                  }}
                                  style={{ width: '100%', padding: '4px 6px', fontSize: 11, border: lineStockError[lineKey] ? '1px solid #dc2626' : '1px solid var(--border)', boxSizing: 'border-box' as const }}
                                />
                                {lineStockError[lineKey] && <div style={{ fontSize: 9, color: '#dc2626', marginTop: 2 }}>{lineStockError[lineKey]}</div>}
                              </div>

                              {/* Type */}
                              <select
                                value={line.itemType}
                                onChange={(e) => updateLine(row.id, line.id, 'itemType', e.target.value as 'RETURNABLE' | 'CONSUMABLE')}
                                style={{ padding: '4px 6px', fontSize: 11, border: '1px solid var(--border)', background: '#fff' }}
                              >
                                <option value="RETURNABLE">Returnable</option>
                                <option value="CONSUMABLE">Consumable</option>
                              </select>

                              {/* Due date — both Date and Days shown, kept in sync */}
                              <input type="date" disabled={line.itemType === 'CONSUMABLE'} min={new Date().toISOString().split('T')[0]}
                                value={line.dueDateValue}
                                onChange={(e) => updateLine(row.id, line.id, 'dueDateValue', e.target.value)}
                                style={{ width: '100%', padding: '4px 6px', fontSize: 11, border: '1px solid var(--border)', boxSizing: 'border-box' as const, opacity: line.itemType === 'CONSUMABLE' ? 0.4 : 1 }} />
                              <input type="number" min={0} placeholder="days" disabled={line.itemType === 'CONSUMABLE'}
                                value={daysDisplay}
                                onChange={(e) => {
                                  const days = e.target.value === '' ? '' : Number(e.target.value);
                                  updateLine(row.id, line.id, 'dueDateValue', days === '' ? '' : daysToDueDate(days));
                                }}
                                style={{ width: '100%', padding: '4px 6px', fontSize: 11, border: '1px solid var(--border)', boxSizing: 'border-box' as const, opacity: line.itemType === 'CONSUMABLE' ? 0.4 : 1 }} />

                              {/* Remove line */}
                              <button type="button" onClick={() => removeProductLine(row.id, line.id)} disabled={row.items.length === 1}
                                title="Remove product"
                                style={{ padding: '4px', fontSize: 14, border: '1px solid var(--border)', background: row.items.length === 1 ? 'var(--surface)' : '#fff', color: row.items.length === 1 ? 'var(--muted)' : '#dc2626', cursor: row.items.length === 1 ? 'not-allowed' : 'pointer' }}>
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      <button type="button" onClick={() => addProductLine(row.id)}
                        style={{ marginTop: 8, padding: '4px 10px', fontSize: 10, border: '1px dashed var(--border)', background: 'var(--bg)', color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}>
                        + Add Product
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Add row / clone controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                <button type="button" onClick={addBlankRow}
                  style={{ padding: '6px 12px', fontSize: 11, border: '1px dashed var(--border)', background: 'var(--bg)', color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}>
                  + Add Row
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>Clone last row ×</span>
                  <input type="number" min={1} value={cloneCount} onChange={(e) => setCloneCount(e.target.value === '' ? '' : Number(e.target.value))}
                    style={{ width: 60, padding: '4px 6px', fontSize: 11, border: '1px solid var(--border)' }} />
                  <button type="button" onClick={() => cloneRowNTimes(formRows[formRows.length - 1].id)}
                    style={{ padding: '6px 12px', fontSize: 11, border: '1px solid var(--border)', background: '#fff', color: 'var(--fg)', cursor: 'pointer', fontWeight: 600 }}>
                    Clone
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <button type="button" onClick={() => { setIsModalOpen(false); resetForm(); }}
                  style={{ padding: '5px 18px', fontSize: 12, border: '1px solid var(--border)', background: '#fff', color: 'var(--fg)', cursor: 'pointer' }}>Cancel</button>
                <button type="submit" disabled={isSubmitting}
                  style={{ padding: '5px 18px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', opacity: isSubmitting ? 0.5 : 1 }}>
                  {isSubmitting ? 'Saving...' : `Save ${formRows.length} ${formRows.length === 1 ? 'Entry' : 'Entries'}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
