"use client";

import { useEffect, useState } from "react";

// Utility function to format date as DD/MM/YYYY
const formatDate = (dateString: string | null): string => {
  if (!dateString) return "â€”";
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

type InvoiceItem = {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
};

type Product = {
  product_id: string;
  product_name: string;
  unit_cost: number;
};

type Invoice = {
  invoice_id: string;
  invoice_number: string;
  supplier_name: string;
  received_date: string;
  total_amount: number;
  items_count: number;
};

type InvoiceDetail = {
  invoice_id: string;
  invoice_number: string;
  supplier_name: string;
  received_date: string;
  created_at: string;
  total_amount: number;
  items: Array<{
    product_name: string;
    quantity: number;
    unit_cost: number;
    total_cost: number;
  }>;
};

export default function BillingPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [receivedDate, setReceivedDate] = useState("");
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([
    { product_id: "", product_name: "", quantity: 1, unit_cost: 0, total_cost: 0 }
  ]);
  
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [showProductDropdown, setShowProductDropdown] = useState<number | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    fetchInvoices();
    fetchProducts();
  }, []);

  async function fetchInvoices() {
    try {
      setLoading(true);
      const res = await fetch("/api/invoices");
      if (res.ok) {
        const data = await res.json();
        setInvoices(data.invoices || []);
      }
    } catch (error) {
      console.error("Error fetching invoices:", error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchProducts() {
    try {
      const res = await fetch("/api/products");
      if (res.ok) {
        const data = await res.json();
        // API returns array directly, not wrapped in {products: [...]}
        setProducts(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error("Error fetching products:", error);
    }
  }

  async function fetchNextInvoiceNo() {
    try {
      const res = await fetch("/api/invoices/next-number");
      if (res.ok) {
        const data = await res.json();
        setInvoiceNo(data.invoice_no);
      } else {
        console.error("Failed to fetch invoice number");
      }
    } catch (error) {
      console.error("Error fetching invoice number:", error);
    }
  }

  const handleOpenModal = () => {
    setIsModalOpen(true);
    fetchNextInvoiceNo();
    // Set today's date as default
    const today = new Date().toISOString().split('T')[0];
    setReceivedDate(today);
  };

  const handleProductSearch = (index: number, query: string) => {
    const updated = [...invoiceItems];
    updated[index].product_name = query;
    setInvoiceItems(updated);

    if (query.trim()) {
      const filtered = products.filter(p =>
        p.product_name.toLowerCase().includes(query.toLowerCase())
      );
      setFilteredProducts(filtered);
      setShowProductDropdown(index);
    } else {
      setFilteredProducts([]);
      setShowProductDropdown(null);
    }
  };

  const selectProduct = (index: number, product: Product) => {
    const updated = [...invoiceItems];
    updated[index] = {
      ...updated[index],
      product_id: product.product_id,
      product_name: product.product_name,
      unit_cost: product.unit_cost,
      total_cost: updated[index].quantity * product.unit_cost,
    };
    setInvoiceItems(updated);
    setShowProductDropdown(null);
    setFilteredProducts([]);
  };

  const addInvoiceItem = () => {
    setInvoiceItems([...invoiceItems, { product_id: "", product_name: "", quantity: 1, unit_cost: 0, total_cost: 0 }]);
  };

  const removeInvoiceItem = (index: number) => {
    if (invoiceItems.length === 1) return;
    setInvoiceItems(invoiceItems.filter((_, i) => i !== index));
  };

  const updateInvoiceItem = (index: number, field: keyof InvoiceItem, value: any) => {
    const updated = [...invoiceItems];
    updated[index] = { ...updated[index], [field]: value };
    setInvoiceItems(updated);
  };

  const resetModal = () => {
    setInvoiceNo("");
    setSupplierName("");
    setReceivedDate("");
    setInvoiceItems([{ product_id: "", product_name: "", quantity: 1, unit_cost: 0, total_cost: 0 }]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Prevent double submission
    if (isSubmitting) return;

    // Validate items
    const validItems = invoiceItems.filter(item => item.product_id && item.quantity > 0);
    if (validItems.length === 0) {
      alert("Please add at least one item with a valid product");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_number: invoiceNo,
          supplier_name: supplierName,
          received_date: receivedDate,
          items: validItems,
        }),
      });

      if (res.ok) {
        alert("Invoice created successfully!");
        setIsModalOpen(false);
        resetModal();
        fetchInvoices();
      } else {
        const error = await res.json();
        alert(`Error: ${error.error || "Failed to create invoice"}`);
      }
    } catch (error) {
      console.error("Error creating invoice:", error);
      alert("An error occurred while creating the invoice");
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredInvoices = invoices.filter((invoice) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      invoice.invoice_number?.toLowerCase().includes(query) ||
      invoice.supplier_name?.toLowerCase().includes(query)
    );
  });

  const calculateGrandTotal = () => {
    return invoiceItems.reduce((sum, item) => sum + (item.total_cost || 0), 0);
  };

  const fetchInvoiceDetails = async (invoiceId: string) => {
    try {
      setLoadingDetail(true);
      const res = await fetch(`/api/invoices/${invoiceId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedInvoice(data);
        setIsPreviewOpen(true);
      } else {
        alert("Failed to load invoice details");
      }
    } catch (error) {
      console.error("Error fetching invoice details:", error);
      alert("An error occurred while loading invoice details");
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleDeleteInvoice = async (invoiceId: string) => {
    if (!confirm("Are you sure you want to delete this invoice? This action cannot be undone.")) {
      return;
    }

    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        alert("Invoice deleted successfully!");
        fetchInvoices();
      } else {
        const error = await res.json();
        alert(`Error: ${error.error || "Failed to delete invoice"}`);
      }
    } catch (error) {
      console.error("Error deleting invoice:", error);
      alert("An error occurred while deleting the invoice");
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)',
    color: 'var(--fg)', background: 'var(--bg)', outline: 'none', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--muted)',
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4,
  };
  const th: React.CSSProperties = {
    padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: 'var(--muted)',
    textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = { padding: '7px 10px', fontSize: 12, color: 'var(--fg)', borderBottom: '1px solid var(--border)' };

  if (loading) return <div style={{ padding: 20, fontSize: 12, color: 'var(--muted)' }}>Loading invoicesâ€¦</div>;


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Billing / Invoices</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Manage purchase invoices</div>
        </div>
        <button
          onClick={handleOpenModal}
          style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          + Create Invoice
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search by invoice number or supplierâ€¦"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        style={{ padding: '6px 10px', fontSize: 12, border: '1px solid var(--border)', color: 'var(--fg)', background: 'var(--bg)', outline: 'none', width: '100%', boxSizing: 'border-box' }}
      />

      {/* Invoices Table */}
      <div style={{ background: '#fff', border: '1px solid var(--border)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface)' }}>
              <th style={th}>#</th>
              <th style={th}>Invoice No</th>
              <th style={th}>Supplier</th>
              <th style={th}>Received Date</th>
              <th style={th}>Items</th>
              <th style={{ ...th, textAlign: 'right' }}>Total</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredInvoices.length === 0 ? (
              <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--muted)', padding: '24px 10px' }}>No invoices found</td></tr>
            ) : (
              filteredInvoices.map((invoice, idx) => (
                <tr key={invoice.invoice_id}>
                  <td style={td}>{idx + 1}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{invoice.invoice_number}</td>
                  <td style={td}>{invoice.supplier_name}</td>
                  <td style={td}>{formatDate(invoice.received_date)}</td>
                  <td style={td}>{invoice.items_count || 0}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>â‚¹{invoice.total_amount?.toFixed(2) || '0.00'}</td>
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
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Invoice Modal */}
      {isModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', padding: 16 }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 760, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Create New Invoice</div>
              <button onClick={() => { setIsModalOpen(false); resetModal(); }} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--muted)', cursor: 'pointer' }}>Ã—</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <form onSubmit={handleSubmit} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Invoice header fields */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Invoice No</label>
                    <input type="text" readOnly value={invoiceNo} style={{ ...inputStyle, background: 'var(--surface)', color: 'var(--muted)', cursor: 'not-allowed' }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Supplier Name</label>
                    <input type="text" required value={supplierName} onChange={(e) => setSupplierName(e.target.value)} style={inputStyle} placeholder="Enter supplier name" />
                  </div>
                  <div>
                    <label style={labelStyle}>Delivered On</label>
                    <input type="date" required value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} style={inputStyle} />
                  </div>
                </div>

                {/* Items */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Invoice Items</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr auto', gap: 6, marginBottom: 4 }}>
                    {['Product', 'Qty', 'Unit Cost', 'Total', ''].map((h) => (
                      <div key={h} style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {invoiceItems.map((item, index) => (
                      <div key={index} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr auto', gap: 6, alignItems: 'start' }}>
                        <div style={{ position: 'relative' }}>
                          <input
                            type="text"
                            placeholder="Search productâ€¦"
                            value={item.product_name}
                            onChange={(e) => handleProductSearch(index, e.target.value)}
                            onFocus={() => { if (item.product_name) handleProductSearch(index, item.product_name); }}
                            style={inputStyle}
                          />
                          {showProductDropdown === index && filteredProducts.length > 0 && (
                            <div style={{ position: 'absolute', zIndex: 10, width: '100%', background: '#fff', border: '1px solid var(--border)', maxHeight: 180, overflowY: 'auto', top: '100%', left: 0 }}>
                              {filteredProducts.map((p) => (
                                <button key={p.product_id} type="button" onClick={() => selectProduct(index, p)}
                                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', fontSize: 12, color: 'var(--fg)', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                                  <div style={{ fontWeight: 500 }}>{p.product_name}</div>
                                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>â‚¹{p.unit_cost}</div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <input type="number" min="1" value={item.quantity}
                          onChange={(e) => {
                            const qty = parseInt(e.target.value) || 1;
                            const updated = [...invoiceItems];
                            updated[index] = { ...updated[index], quantity: qty, total_cost: qty * updated[index].unit_cost };
                            setInvoiceItems(updated);
                          }}
                          style={inputStyle} />
                        <input type="number" step="0.01" value={item.unit_cost} readOnly style={{ ...inputStyle, background: 'var(--surface)', color: 'var(--muted)' }} />
                        <input type="number" step="0.01" value={item.total_cost.toFixed(2)} readOnly style={{ ...inputStyle, background: 'var(--surface)', color: 'var(--muted)' }} />
                        <button type="button" onClick={() => removeInvoiceItem(index)} disabled={invoiceItems.length === 1}
                          style={{ padding: '5px 8px', fontSize: 11, border: '1px solid var(--border)', background: 'none', color: invoiceItems.length === 1 ? 'var(--muted)' : '#b91c1c', cursor: invoiceItems.length === 1 ? 'not-allowed' : 'pointer' }}>
                          Ã—
                        </button>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={addInvoiceItem}
                    style={{ marginTop: 8, fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    + Add item
                  </button>
                </div>

                {/* Grand total */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Grand Total</span>
                  <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg)' }}>â‚¹{calculateGrandTotal().toFixed(2)}</span>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button type="button" onClick={() => { setIsModalOpen(false); resetModal(); }} disabled={isSubmitting}
                    style={{ padding: '5px 14px', fontSize: 12, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button type="submit" disabled={isSubmitting}
                    style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}>
                    {isSubmitting ? 'Creatingâ€¦' : 'Create Invoice'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Preview Invoice Modal */}
      {isPreviewOpen && selectedInvoice && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', padding: 16 }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 680, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Invoice â€” {selectedInvoice.invoice_number}</div>
              <button onClick={() => { setIsPreviewOpen(false); setSelectedInvoice(null); }} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--muted)', cursor: 'pointer' }}>Ã—</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Meta */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
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
                        <td style={{ ...td, textAlign: 'right' }}>â‚¹{item.unit_cost.toFixed(2)}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>â‚¹{item.total_cost.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Total */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Amount</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg)' }}>â‚¹{selectedInvoice.total_amount.toFixed(2)}</span>
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
      )}
    </div>
  );
}
      {/* Header */}
