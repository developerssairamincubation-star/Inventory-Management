"use client";

import { useEffect, useState } from "react";

// Utility function to format date as DD/MM/YYYY
const formatDate = (dateString: string | null): string => {
  if (!dateString) return "—";
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

type StudentRecord = {
  student_id: string;
  student_name: string;
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

export default function StudentsPage() {
  const [records, setRecords] = useState<StudentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState("Monthly");
  const [searchQuery, setSearchQuery] = useState("");
  
  // Stats
  const [totalBorrowed, setTotalBorrowed] = useState(0);
  const [returned, setReturned] = useState(0);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    fetchStudentRecords();
  }, [timeFilter]);

  async function fetchStudentRecords() {
    try {
      setLoading(true);
      const res = await fetch(`/api/students/records?period=${timeFilter.toLowerCase()}`);
      if (res.ok) {
        const data = await res.json();
        setRecords(data.records || []);
        setTotalBorrowed(data.stats?.totalBorrowed || 0);
        setReturned(data.stats?.returned || 0);
        setPending(data.stats?.pending || 0);
      } else {
        console.error("Failed to fetch student records");
      }
    } catch (error) {
      console.error("Error fetching student records:", error);
    } finally {
      setLoading(false);
    }
  }

  const filteredRecords = records.filter((record) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      record.student_name?.toLowerCase().includes(query) ||
      record.department?.toLowerCase().includes(query) ||
      record.product_name?.toLowerCase().includes(query) ||
      record.mobile?.toLowerCase().includes(query)
    );
  });

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
  };
  const td: React.CSSProperties = {
    padding: '7px 10px',
    fontSize: 12,
    color: 'var(--fg)',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  };

  if (loading) return <div style={{ padding: 20, fontSize: 12, color: 'var(--muted)' }}>Loading student records…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Student Records</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Borrowing history by students</div>
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

      {/* Search */}
      <div>
        <input
          type="text"
          placeholder="Search by name, department, product, mobile…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '6px 10px',
            fontSize: 12,
            border: '1px solid var(--border)',
            color: 'var(--fg)',
            background: 'var(--bg)',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Table */}
      <div style={{ background: '#fff', border: '1px solid var(--border)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ background: 'var(--surface)' }}>
              <th style={th}>#</th>
              <th style={th}>Student Name</th>
              <th style={th}>Dept</th>
              <th style={th}>Mentor</th>
              <th style={th}>Product</th>
              <th style={th}>Qty</th>
              <th style={th}>Borrow Date</th>
              <th style={th}>Return Date</th>
              <th style={th}>Status</th>
              <th style={th}>Mobile</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecords.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ ...td, textAlign: 'center', color: 'var(--muted)', padding: '24px 10px' }}>
                  No student records found
                </td>
              </tr>
            ) : (
              filteredRecords.map((record, idx) => {
                const PENDING_STATUSES = ["PENDING", "PARTIALLY_RETURNED", "PARTIALLY_DAMAGED", "PARTIALLY_LOST"];
                const FINAL_RETURNED = ["RETURNED", "RETURNED_DAMAGED", "RETURNED_LOST"];
                const d = record.damaged_quantity ?? 0;
                const l = record.lost_quantity ?? 0;
                const orig = record.original_quantity ?? record.quantity;

                const statusCell = (() => {
                  if (PENDING_STATUSES.includes(record.status)) {
                    const color =
                      record.status === "PARTIALLY_DAMAGED" ? { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fca5a5' }
                      : record.status === "PARTIALLY_LOST"   ? { background: '#fff7ed', color: '#c2410c', border: '1px solid #fdba74' }
                      : record.status === "PARTIALLY_RETURNED"? { background: '#eff6ff', color: '#1d4ed8', border: '1px solid #93c5fd' }
                      : { background: '#fefce8', color: '#854d0e', border: '1px solid #fde68a' };
                    const label = record.status.replace(/_/g, ' ');
                    return <span style={{ ...color, padding: '2px 7px', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>;
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
                    <td style={td}>{idx + 1}</td>
                    <td style={{ ...td, fontWeight: 500 }}>{record.student_name || '—'}</td>
                    <td style={td}>{record.department || '—'}</td>
                    <td style={td}>{record.mentor || '—'}</td>
                    <td style={td}>{record.product_name || '—'}</td>
                    <td style={td}>{record.quantity || 0}</td>
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
    </div>
  );
}
