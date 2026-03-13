"use client";

import { useEffect, useState, useRef } from "react";
import { ArrowUpNarrowWide, ArrowUpWideNarrow } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

const ROWS_PER_PAGE = 20;

// Utility function to format date as DD/MM/YYYY
const formatDate = (dateString: string | null): string => {
  if (!dateString) return "—";
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

type SortCol = 'borrow_date' | 'return_date' | 'quantity' | null;
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
  fontSize: 12,
  border: '1px solid var(--border)',
  padding: '5px 8px',
  color: 'var(--fg)',
  background: 'var(--bg)',
  outline: 'none',
  cursor: 'pointer',
  minWidth: 130,
};

type StaffRecord = {
  staff_id: string;
  staff_name: string;
  department: string;
  mentor: string;
  product_name: string;
  quantity: number;
  original_quantity: number;
  damaged_quantity: number;
  lost_quantity: number;
  borrow_date: string;
  return_date: string | null;
  status: string;
  mobile: string;
};

export default function StaffsPage() {
  const [records, setRecords] = useState<StaffRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState("Monthly");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);

  // Filters
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [mentorFilter, setMentorFilter] = useState('');

  // Sort
  const [sortCol, setSortCol] = useState<SortCol>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Dropdown data
  const [departments, setDepartments] = useState<{ department_id: string; department_name: string }[]>([]);
  const [products, setProducts] = useState<{ product_id: string; product_name: string }[]>([]);

  // Stats
  const [totalBorrowed, setTotalBorrowed] = useState(0);
  const [returned, setReturned] = useState(0);
  const [pending, setPending] = useState(0);

  const { showToast } = useToast();

  useEffect(() => {
    fetchStaffRecords();
    fetchDepartments();
    fetchProducts();
  }, [timeFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, timeFilter, deptFilter, statusFilter, productFilter, mentorFilter, sortCol, sortDir]);

  async function fetchDepartments() {
    try {
      const res = await fetch('/api/departments');
      if (res.ok) { const data = await res.json(); setDepartments(data || []); }
    } catch { /* ignore */ }
  }

  async function fetchProducts() {
    try {
      const res = await fetch('/api/products');
      if (res.ok) {
        const data = await res.json();
        const arr = Array.isArray(data) ? data : (data.products || []);
        setProducts(arr.map((p: any) => ({ product_id: p.product_id ?? p.id, product_name: p.product_name ?? p.name })));
      }
    } catch { /* ignore */ }
  }

  async function fetchStaffRecords() {
    try {
      setLoading(true);
      const res = await fetch(`/api/staffs/records?period=${timeFilter.toLowerCase()}`);
      if (res.ok) {
        const data = await res.json();
        setRecords(data.records || []);
        setTotalBorrowed(data.stats?.totalBorrowed || 0);
        setReturned(data.stats?.returned || 0);
        setPending(data.stats?.pending || 0);
      } else {
        const errorData = await res.json();
        console.error("Failed to fetch staff records:", errorData);
        showToast(`Error: ${errorData.error || "Failed to fetch staff records"}`, "error");
      }
    } catch (error) {
      console.error("Error fetching staff records:", error);
      showToast(`Failed to load staff records`, "error");
    } finally {
      setLoading(false);
    }
  }

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

  const uniqueMentors = Array.from(new Set(records.map(r => r.mentor).filter(Boolean)));

  let filteredRecords = records.filter((record) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const match = (
        record.staff_name?.toLowerCase().includes(query) ||
        record.department?.toLowerCase().includes(query) ||
        record.product_name?.toLowerCase().includes(query) ||
        record.mobile?.toLowerCase().includes(query)
      );
      if (!match) return false;
    }
    if (deptFilter && record.department !== deptFilter) return false;
    if (statusFilter && !matchesStatusFilter(record.status, statusFilter)) return false;
    if (productFilter && record.product_name !== productFilter) return false;
    if (mentorFilter && record.mentor !== mentorFilter) return false;
    return true;
  });

  if (sortCol) {
    filteredRecords = [...filteredRecords].sort((a, b) => {
      let av: number, bv: number;
      if (sortCol === 'borrow_date') { av = new Date(a.borrow_date).getTime(); bv = new Date(b.borrow_date).getTime(); }
      else if (sortCol === 'return_date') { av = a.return_date ? new Date(a.return_date).getTime() : -Infinity; bv = b.return_date ? new Date(b.return_date).getTime() : -Infinity; }
      else { av = a.original_quantity ?? a.quantity; bv = b.original_quantity ?? b.quantity; }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / ROWS_PER_PAGE));
  const pageRows = showAll ? filteredRecords : filteredRecords.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target as Node)) {
        setShowExportDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const exportExcel = () => {
    const data = filteredRecords.map((record, i) => {
      const orig = record.original_quantity ?? record.quantity;
      const d = record.damaged_quantity ?? 0;
      const l = record.lost_quantity ?? 0;
      let statusStr = record.status || '—';
      const PENDING_STATUSES = ['PENDING', 'PARTIALLY_RETURNED', 'PARTIALLY_DAMAGED', 'PARTIALLY_LOST'];
      if (record.status === 'CONSUMABLE') statusStr = 'CONSUMABLE';
      else if (PENDING_STATUSES.includes(record.status)) statusStr = record.status.replace(/_/g, ' ');
      else {
        const returnedCount = Math.max(0, orig - d - l);
        const parts: string[] = [];
        if (returnedCount > 0) parts.push(`${returnedCount} Returned`);
        if (d > 0) parts.push(`${d} Damaged`);
        if (l > 0) parts.push(`${l} Lost`);
        if (parts.length > 0) statusStr = parts.join(', ');
      }
      return {
        'S.No': i + 1,
        'Staff Name': record.staff_name || '',
        'Department': record.department || '',
        'Product': record.product_name || '',
        'Quantity': orig,
        'Borrow Date': formatDate(record.borrow_date),
        'Return Date': formatDate(record.return_date),
        'Status': statusStr,
        'Mobile': record.mobile || '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Staff Lending Data');
    XLSX.writeFile(wb, `staff-lending-data-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const extractDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Lending Data \u2013 Staff', 14, 16);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Extracted on: ${extractDate}`, 14, 23);
    const head = [['S.No', 'Staff Name', 'Dept', 'Product', 'Qty', 'Borrow Date', 'Return Date', 'Status', 'Mobile']];
    const body = filteredRecords.map((record, i) => {
      const orig = record.original_quantity ?? record.quantity;
      const d = record.damaged_quantity ?? 0;
      const l = record.lost_quantity ?? 0;
      let statusStr = record.status || '\u2014';
      const PENDING_STATUSES = ['PENDING', 'PARTIALLY_RETURNED', 'PARTIALLY_DAMAGED', 'PARTIALLY_LOST'];
      if (record.status === 'CONSUMABLE') statusStr = 'CONSUMABLE';
      else if (PENDING_STATUSES.includes(record.status)) statusStr = record.status.replace(/_/g, ' ');
      else {
        const returnedCount = Math.max(0, orig - d - l);
        const parts: string[] = [];
        if (returnedCount > 0) parts.push(`${returnedCount} Returned`);
        if (d > 0) parts.push(`${d} Damaged`);
        if (l > 0) parts.push(`${l} Lost`);
        if (parts.length > 0) statusStr = parts.join(', ');
      }
      return [
        i + 1,
        record.staff_name || '\u2014',
        record.department || '\u2014',
        record.product_name || '\u2014',
        orig,
        formatDate(record.borrow_date),
        formatDate(record.return_date),
        statusStr,
        record.mobile || '\u2014',
      ];
    });
    autoTable(doc, {
      head,
      body,
      startY: 28,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [30, 41, 56], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
    });
    doc.save(`staff-lending-data-${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const th: React.CSSProperties = {
    padding: '6px 10px',
    textAlign: 'left',
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    border: '1px solid #d1d1d1',
  };
  const td: React.CSSProperties = {
    padding: '7px 10px',
    fontSize: 12,
    color: 'var(--fg)',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
    border: '1px solid #d1d1d1',
  };

  if (loading) return <div style={{ padding: 20, fontSize: 12, color: 'var(--muted)' }}>Loading staff records…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Staff Records</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Borrowing history by staff</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
          <select
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value)}
            style={{ fontSize: 11, border: '1px solid var(--border)', padding: '4px 8px', color: 'var(--fg)', background: 'var(--bg)', outline: 'none' }}
          >
            <option>Daily</option>
            <option>Weekly</option>
            <option>Monthly</option>
            <option>Yearly</option>
          </select>
        </div>
      </div>

      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', background: '#fff', border: '1px solid var(--border)' }}>
        {[
          { label: 'Total Borrowed', value: totalBorrowed },
          { label: 'Returned',       value: returned },
          { label: 'Pending',        value: pending },
        ].map((s, i, arr) => (
          <div key={s.label} style={{ padding: '14px 16px', borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.02em', lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} style={selectStyle}>
          <option value="">All Departments</option>
          {departments.map(d => <option key={d.department_id} value={d.department_name}>{d.department_name}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="">All Status</option>
          <option value="PENDING">Pending</option>
          <option value="CONSUMABLE">Consumable</option>
          <option value="RETURNED">Returned</option>
          <option value="DAMAGED">Damaged</option>
          <option value="LOST">Lost</option>
        </select>
        <select value={productFilter} onChange={e => setProductFilter(e.target.value)} style={selectStyle}>
          <option value="">All Products</option>
          {products.map(p => <option key={p.product_id} value={p.product_name}>{p.product_name}</option>)}
        </select>
        <select value={mentorFilter} onChange={e => setMentorFilter(e.target.value)} style={selectStyle}>
          <option value="">All Mentors</option>
          {uniqueMentors.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <input
          type="text"
          placeholder="Search by name, dept, product, mobile…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: 1, minWidth: 180, padding: '5px 10px', fontSize: 12, border: '1px solid var(--border)', color: 'var(--fg)', background: 'var(--bg)', outline: 'none' }}
        />
        {(deptFilter || statusFilter || productFilter || mentorFilter || searchQuery) && (
          <button
            onClick={() => { setDeptFilter(''); setStatusFilter(''); setProductFilter(''); setMentorFilter(''); setSearchQuery(''); }}
            style={{ padding: '5px 10px', fontSize: 11, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--muted)', cursor: 'pointer' }}
          >Clear</button>
        )}
      </div>

      {/* Table */}
      <div style={{ background: '#fff', border: '1px solid var(--border)', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1, minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface)' }}>
            <tr style={{ background: 'var(--surface)' }}>
              <th style={th}>S.No</th>
              <th style={th}>Staff Name</th>
              <th style={th}>Dept</th>
              <th style={th}>Product</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => handleSort('quantity')}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>Qty <SortIcon col="quantity" /></span></th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => handleSort('borrow_date')}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>Borrow Date <SortIcon col="borrow_date" /></span></th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => handleSort('return_date')}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>Return Date <SortIcon col="return_date" /></span></th>
              <th style={th}>Status</th>
              <th style={th}>Mobile</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecords.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ ...td, textAlign: 'center', color: 'var(--muted)', padding: '24px 10px' }}>
                  No staff records found
                </td>
              </tr>
            ) : (
              pageRows.map((record, localIdx) => {
                const idx = showAll ? localIdx : (currentPage - 1) * ROWS_PER_PAGE + localIdx;
                const PENDING_STATUSES = ["PENDING", "PARTIALLY_RETURNED", "PARTIALLY_DAMAGED", "PARTIALLY_LOST"];
                const d = record.damaged_quantity ?? 0;
                const l = record.lost_quantity ?? 0;
                const orig = record.original_quantity ?? record.quantity;

                const statusCell = (() => {
                  if (record.status === 'CONSUMABLE') {
                    return <span style={{ background: '#ede9fe', color: '#6d28d9', padding: '2px 7px', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>CONSUMABLE</span>;
                  }
                  if (PENDING_STATUSES.includes(record.status)) {
                    const color =
                      record.status === "PARTIALLY_DAMAGED" ? { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fca5a5' }
                      : record.status === "PARTIALLY_LOST"   ? { background: '#fff7ed', color: '#c2410c', border: '1px solid #fdba74' }
                      : record.status === "PARTIALLY_RETURNED"? { background: '#eff6ff', color: '#1d4ed8', border: '1px solid #93c5fd' }
                      : { background: '#fefce8', color: '#854d0e', border: '1px solid #fde68a' };
                    return <span style={{ ...color, padding: '2px 7px', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>{record.status.replace(/_/g,' ')}</span>;
                  }
                  const returnedCount = Math.max(0, orig - d - l);
                  const hasPills = returnedCount > 0 || d > 0 || l > 0;
                  if (hasPills) {
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {returnedCount > 0 && <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 7px', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>{returnedCount} Returned</span>}
                        {d > 0 && <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 7px', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>{d} Damaged</span>}
                        {l > 0 && <span style={{ background: '#fef9c3', color: '#713f12', padding: '2px 7px', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>{l} Lost</span>}
                      </div>
                    );
                  }
                  return <span style={{ background: 'var(--surface)', color: 'var(--muted)', padding: '2px 7px', fontSize: 10, fontWeight: 600, border: '1px solid var(--border)' }}>{record.status || '—'}</span>;
                })();

                return (
                  <tr key={idx}>
                    <td style={{ ...td, color: 'var(--muted)' }}>{idx + 1}</td>
                    <td style={{ ...td, fontWeight: 500 }}>{record.staff_name || '—'}</td>
                    <td style={td}>{record.department || '—'}</td>
                    <td style={td}>{record.product_name || '—'}</td>
                    <td style={td}>{orig}</td>
                    <td style={td}>{formatDate(record.borrow_date)}</td>
                    <td style={td}>{formatDate(record.return_date)}</td>
                    <td style={{ ...td, whiteSpace: 'normal' }}>{statusCell}</td>
                    <td style={td}>{record.mobile || '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>

        {/* Pagination */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {showAll
                ? `Showing all ${filteredRecords.length} records`
                : `Showing ${filteredRecords.length === 0 ? 0 : (currentPage - 1) * ROWS_PER_PAGE + 1}–${Math.min(currentPage * ROWS_PER_PAGE, filteredRecords.length)} of ${filteredRecords.length}`}
            </div>
            <button
              onClick={() => { setShowAll(v => !v); setCurrentPage(1); }}
              style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: '1px solid var(--border)', padding: '2px 8px', cursor: 'pointer' }}
            >
              {showAll ? 'Paginate' : 'Show All'}
            </button>
          </div>
          {!showAll && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}
                style={{ padding: '3px 10px', fontSize: 11, border: '1px solid var(--border)', background: '#fff', color: currentPage === 1 ? 'var(--muted)' : 'var(--fg)', cursor: currentPage === 1 ? 'default' : 'pointer' }}>
                Prev
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const page = totalPages <= 5 ? i + 1 : currentPage <= 3 ? i + 1 : currentPage + i - 2;
                if (page < 1 || page > totalPages) return null;
                return (
                  <button key={page} onClick={() => setCurrentPage(page)}
                    style={{ padding: '3px 10px', fontSize: 11, border: '1px solid var(--border)', background: currentPage === page ? 'var(--accent)' : '#fff', color: currentPage === page ? '#fff' : 'var(--fg)', cursor: 'pointer', fontWeight: currentPage === page ? 600 : 400 }}>
                    {page}
                  </button>
                );
              })}
              <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}
                style={{ padding: '3px 10px', fontSize: 11, border: '1px solid var(--border)', background: '#fff', color: currentPage === totalPages ? 'var(--muted)' : 'var(--fg)', cursor: currentPage === totalPages ? 'default' : 'pointer' }}>
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
