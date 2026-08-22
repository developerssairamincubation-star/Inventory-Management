"use client";
import { authFetch, useUser } from "@/contexts/UserContext";

import { useEffect, useState } from "react";
import { ArrowUpNarrowWide, ArrowUpWideNarrow } from "lucide-react";
import UploadInvoiceModal from "@/components/UploadInvoiceModal";
import { useToast } from "@/components/ui/Toast";
import Pagination from "@/components/Pagination";
import { usePagination } from "@/hooks/usePagination";

// Utility function to format date as DD/MM/YYYY
const formatDate = (dateString: string | null): string => {
  if (!dateString) return "—";
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

type SortColB = 'invoice_number' | 'received_date' | 'items_count' | 'total_amount' | null;
type SortDirB = 'asc' | 'desc';

type Product = {
  product_id: string;
  product_name: string;
  unit_cost: number;
  stocks?: { quantity: number; location: string | null } | null;
};

type Invoice = {
  invoice_id: string;
  invoice_code: string;
  invoice_number: string;
  supplier_name: string;
  received_date: string;
  total_amount: number;
  items_count: number;
  user_id: string;
  owner_name: string | null;
  domain_name: string | null;
};

type InvoiceDetail = {
  invoice_id: string;
  invoice_code: string;
  invoice_number: string;
  supplier_name: string;
  received_date: string;
  created_at: string;
  total_amount: number;
  file_url: string | null;
  items: Array<{
    product_name: string;
    quantity: number;
    unit_cost: number;
    total_cost: number;
  }>;
};

export default function BillingPage() {
  const { appUser } = useUser();
  const isAdmin = appUser?.role === "super_admin";
  const [products, setProducts] = useState<Product[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Sort
  const [sortColB, setSortColB] = useState<SortColB>(null);
  const [sortDirB, setSortDirB] = useState<SortDirB>('asc');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const { showToast, showConfirm } = useToast();

  useEffect(() => {
    fetchInvoices();
    fetchProducts();
  }, []);

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, supplierFilter, dateFrom, dateTo, sortColB, sortDirB]);

  async function fetchInvoices() {
    try {
      setLoading(true);
      const res = await authFetch("/api/invoices");
      if (res.ok) {
        const data = await res.json();
        setInvoices(data.invoices || []);
      } else {
        console.error("Failed to fetch invoices:", res.status);
        showToast("Couldn't load invoices. Please refresh and try again.", "error");
      }
    } catch (error) {
      console.error("Error fetching invoices:", error);
      showToast("Couldn't load invoices. Please check your connection and try again.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function fetchProducts() {
    try {
      const res = await authFetch("/api/products");
      if (res.ok) {
        const data = await res.json();
        // API returns array directly, not wrapped in {products: [...]}
        setProducts(Array.isArray(data) ? data : []);
      } else {
        console.error("Failed to fetch products:", res.status);
      }
    } catch (error) {
      console.error("Error fetching products:", error);
    }
  }

  const handleSortB = (col: SortColB) => {
    if (sortColB === col) setSortDirB(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortColB(col); setSortDirB('asc'); }
  };

  const SortIconB = ({ col }: { col: SortColB }) => {
    if (sortColB !== col) return <ArrowUpNarrowWide size={11} style={{ opacity: 0.3, flexShrink: 0 }} />;
    return sortDirB === 'asc'
      ? <ArrowUpNarrowWide size={11} style={{ flexShrink: 0, color: 'var(--accent)' }} />
      : <ArrowUpWideNarrow size={11} style={{ flexShrink: 0, color: 'var(--accent)' }} />;
  };

  const supplierOptions = Array.from(new Set(invoices.map((inv) => inv.supplier_name).filter(Boolean))).sort();

  let filteredInvoices = invoices.filter((invoice) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matches =
        invoice.invoice_number?.toLowerCase().includes(query) ||
        invoice.supplier_name?.toLowerCase().includes(query);
      if (!matches) return false;
    }
    if (supplierFilter && invoice.supplier_name !== supplierFilter) return false;
    if (dateFrom && invoice.received_date && invoice.received_date < dateFrom) return false;
    if (dateTo && invoice.received_date && invoice.received_date > dateTo) return false;
    return true;
  });

  if (sortColB) {
    filteredInvoices = [...filteredInvoices].sort((a, b) => {
      let av: any, bv: any;
      if (sortColB === 'invoice_number') { av = a.invoice_number ?? ''; bv = b.invoice_number ?? ''; return sortDirB === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av); }
      if (sortColB === 'received_date') { av = new Date(a.received_date).getTime(); bv = new Date(b.received_date).getTime(); }
      else if (sortColB === 'items_count') { av = a.items_count ?? 0; bv = b.items_count ?? 0; }
      else { av = a.total_amount ?? 0; bv = b.total_amount ?? 0; }
      return sortDirB === 'asc' ? av - bv : bv - av;
    });
  }

  const { page, setPage, totalPages, padRows, showAll, setShowAll, startIdx, endIdx } = usePagination(filteredInvoices, { pageSize: 50 });

  const fetchInvoiceDetails = async (invoiceId: string) => {
    try {
      setLoadingDetail(true);
      const res = await authFetch(`/api/invoices/${invoiceId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedInvoice(data);
        setIsPreviewOpen(true);
      } else {
        showToast("Failed to load invoice details", "error");
      }
    } catch (error) {
      console.error("Error fetching invoice details:", error);
      showToast("An error occurred while loading invoice details", "error");
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleDeleteInvoice = async (invoiceId: string) => {
    if (!(await showConfirm("Are you sure you want to delete this invoice? This action cannot be undone."))) {
      return;
    }

    try {
      const res = await authFetch(`/api/invoices/${invoiceId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        showToast("Invoice deleted successfully!", "success");
        fetchInvoices();
      } else {
        const error = await res.json();
        showToast(`Error: ${error.error || "Failed to delete invoice"}`, "error");
      }
    } catch (error) {
      console.error("Error deleting invoice:", error);
      showToast("An error occurred while deleting the invoice", "error");
    }
  };

  const th: React.CSSProperties = {
    padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: 'var(--muted)',
    textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', userSelect: 'none',
  };
  const td: React.CSSProperties = { padding: '7px 10px', fontSize: 12, color: 'var(--fg)', borderBottom: '1px solid var(--border)' };

  if (loading) return <div style={{ padding: 20, fontSize: 12, color: 'var(--muted)' }}>Loading invoices…</div>;


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Invoice</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Manage purchase invoices</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setIsUploadModalOpen(true)}
            style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            ↑ Upload Invoice
          </button>
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search by invoice number or supplier…"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        style={{ padding: '6px 10px', fontSize: 12, border: '1px solid var(--border)', color: 'var(--fg)', background: 'var(--bg)', outline: 'none', width: '100%', boxSizing: 'border-box' }}
      />

      {/* Filters Row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <select
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
          style={{ padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', color: 'var(--fg)', background: 'var(--bg)', outline: 'none', cursor: 'pointer' }}
        >
          <option value="">All Suppliers</option>
          {supplierOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
          From
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{ padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', color: 'var(--fg)', background: 'var(--bg)', outline: 'none' }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
          To
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{ padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', color: 'var(--fg)', background: 'var(--bg)', outline: 'none' }}
          />
        </label>
        {(searchQuery || supplierFilter || dateFrom || dateTo) && (
          <button
            onClick={() => { setSearchQuery(''); setSupplierFilter(''); setDateFrom(''); setDateTo(''); }}
            style={{ padding: '5px 8px', fontSize: 11, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--muted)', cursor: 'pointer' }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Invoices Table */}
      <div style={{ background: '#fff', border: '1px solid var(--border)', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1, minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
            <tr style={{ background: 'var(--surface)' }}>
              <th style={th}>S.No</th>
              <th style={th}>Invoice ID</th>
              <th onClick={() => handleSortB('invoice_number')} style={{ ...th, cursor: 'pointer' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>Invoice No <SortIconB col="invoice_number" /></span></th>
              <th style={th}>Supplier</th>
              <th onClick={() => handleSortB('received_date')} style={{ ...th, cursor: 'pointer' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>Received Date <SortIconB col="received_date" /></span></th>
              <th onClick={() => handleSortB('items_count')} style={{ ...th, cursor: 'pointer' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>Items <SortIconB col="items_count" /></span></th>
              <th onClick={() => handleSortB('total_amount')} style={{ ...th, textAlign: 'right', cursor: 'pointer' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>Total <SortIconB col="total_amount" /></span></th>
              {isAdmin && <th style={th}>Added By</th>}
              {isAdmin && <th style={th}>Domain</th>}
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredInvoices.length === 0 ? (
              <tr><td colSpan={isAdmin ? 10 : 8} style={{ ...td, textAlign: 'center', color: 'var(--muted)', padding: '24px 10px' }}>No invoices found</td></tr>
            ) : (
              padRows.map((invoice, localIdx) => {
                if (!invoice) {
                  return (
                    <tr key={`empty-${localIdx}`}>
                      <td style={{ ...td, border: 'none' }} colSpan={isAdmin ? 10 : 8}>&nbsp;</td>
                    </tr>
                  );
                }
                const idx = showAll ? localIdx : startIdx + localIdx;
                return (
                  <tr key={invoice.invoice_id}>
                    <td style={{ ...td, color: 'var(--muted)' }}>{idx + 1}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{invoice.invoice_code}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{invoice.invoice_number}</td>
                    <td style={td}>{invoice.supplier_name}</td>
                    <td style={td}>{formatDate(invoice.received_date)}</td>
                    <td style={td}>{invoice.items_count || 0}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>₹{invoice.total_amount?.toFixed(2) || '0.00'}</td>
                    {isAdmin && <td style={td}>{invoice.owner_name || '—'}</td>}
                    {isAdmin && <td style={td}>{invoice.domain_name || '—'}</td>}
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => fetchInvoiceDetails(invoice.invoice_id)}
                          style={{ padding: '3px 10px', fontSize: 11, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--accent)', cursor: 'pointer' }}
                        >
                          View
                        </button>
                        <button
                          onClick={() => handleDeleteInvoice(invoice.invoice_id)}
                          style={{ padding: '3px 10px', fontSize: 11, border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', cursor: 'pointer' }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>

        {/* Pagination Controls */}
        {filteredInvoices.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', background: 'var(--surface)', padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
          <div>
            Showing {showAll ? filteredInvoices.length : `${startIdx + 1}-${Math.min(endIdx, filteredInvoices.length)}`} of {filteredInvoices.length}
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} showAll={showAll} onToggleShowAll={setShowAll} />
        </div>
      )}
      </div>

      {/* Upload Invoice Modal */}
      {isUploadModalOpen && (
        <UploadInvoiceModal
          existingProducts={products.map((p) => ({ ...p, location: p.stocks?.location ?? null }))}
          onClose={() => setIsUploadModalOpen(false)}
          onSuccess={() => { fetchInvoices(); }}
        />
      )}

      {/* Preview Invoice Modal */}
      {isPreviewOpen && selectedInvoice && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', padding: 16 }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 1080, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Invoice — {selectedInvoice.invoice_code}</div>
              <button onClick={() => { setIsPreviewOpen(false); setSelectedInvoice(null); }} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--muted)', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              {/* Original document */}
              <div style={{ width: '42%', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {selectedInvoice.file_url ? (
                  <>
                    {/* iframe, not <object>: the CSP keeps object-src at 'none'
                        (see next.config.ts), which blocks <object> outright and
                        made this pane render its fallback text instead of the
                        PDF. The "Open original in new tab" link below is the
                        escape hatch an iframe can't express as child content. */}
                    <iframe
                      src={selectedInvoice.file_url}
                      title={`Invoice ${selectedInvoice.invoice_code} original document`}
                      style={{ flex: 1, width: '100%', minHeight: 0, border: 'none' }}
                    />
                    <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
                      <a href={selectedInvoice.file_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--accent)' }}>Open original in new tab ↗</a>
                    </div>
                  </>
                ) : (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center' }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      No invoice document attached.<br />This invoice predates the document-upload feature, or was created without a PDF.
                    </div>
                  </div>
                )}
              </div>

              {/* Parsed data */}
              <div style={{ overflowY: 'auto', flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
                {/* Meta */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {[
                    { label: 'Invoice ID',     value: selectedInvoice.invoice_code },
                    { label: 'Invoice Number', value: selectedInvoice.invoice_number },
                    { label: 'Supplier',       value: selectedInvoice.supplier_name },
                    { label: 'Created',        value: formatDate(selectedInvoice.created_at) },
                    { label: 'Delivered',      value: formatDate(selectedInvoice.received_date) },
                  ].map((m) => (
                    <div key={m.label}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>{m.label}</div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{m.value}</div>
                    </div>
                  ))}
                </div>
                {/* Items table */}
                <div style={{ border: '1px solid var(--border)', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--surface)' }}>
                        <th style={th}>#</th>
                        <th style={th}>Product</th>
                        <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                        <th style={{ ...th, textAlign: 'right' }}>Unit Cost</th>
                        <th style={{ ...th, textAlign: 'right' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedInvoice.items.map((item, idx) => (
                        <tr key={idx}>
                          <td style={td}>{idx + 1}</td>
                          <td style={{ ...td, fontWeight: 500 }}>{item.product_name}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{item.quantity}</td>
                          <td style={{ ...td, textAlign: 'right' }}>₹{item.unit_cost.toFixed(2)}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>₹{item.total_cost.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Total */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Amount</span>
                  <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg)' }}>₹{selectedInvoice.total_amount.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={() => { setIsPreviewOpen(false); setSelectedInvoice(null); }}
                    style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, background: 'var(--fg)', color: '#fff', border: 'none', cursor: 'pointer' }}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
