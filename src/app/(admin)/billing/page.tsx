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
  invoice_no: string;
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

  if (loading) return <div className="p-6">Loading invoices...</div>;

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Invoice Details</h1>
        <button
          onClick={handleOpenModal}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-800 text-sm font-medium"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create Invoice
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by invoice number or supplier..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-4 py-2 border rounded text-sm text-slate-900 placeholder:text-slate-500"
        />
      </div>

      {/* Invoices Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-slate-700 text-white">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">S.No</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Invoice No</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Supplier Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Received Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Items</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Total Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No invoices found
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((invoice, idx) => (
                  <tr key={invoice.invoice_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm text-slate-700">{idx + 1}</td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{invoice.invoice_number}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{invoice.supplier_name}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{formatDate(invoice.received_date)}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{invoice.items_count || 0}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900">₹{invoice.total_amount?.toFixed(2) || "0.00"}</td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => fetchInvoiceDetails(invoice.invoice_id)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                          title="Preview Invoice"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeleteInvoice(invoice.invoice_id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                          title="Delete Invoice"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Invoice Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">Create New Invoice</h2>
              <button
                onClick={() => { setIsModalOpen(false); resetModal(); }}
                className="text-slate-400 hover:text-slate-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Invoice Details */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-2">Invoice No</label>
                  <input
                    type="text"
                    readOnly
                    value={invoiceNo}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900 bg-slate-100 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-2">Supplier Name</label>
                  <input
                    type="text"
                    required
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
                    placeholder="Enter supplier name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-2">Delivered On</label>
                  <input
                    type="date"
                    required
                    value={receivedDate}
                    onChange={(e) => setReceivedDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
              </div>

              {/* Invoice Items */}
              <div className="border-t pt-4">
                <label className="block text-sm font-medium text-slate-900 mb-3">Invoice Items</label>
                {/* Column Headers */}
                <div className="grid grid-cols-12 gap-3 mb-2">
                  <div className="col-span-4">
                    <span className="text-xs font-semibold text-slate-600 uppercase">Product Name</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-xs font-semibold text-slate-600 uppercase">Quantity</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-xs font-semibold text-slate-600 uppercase">Unit Cost</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-xs font-semibold text-slate-600 uppercase">Total Cost</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-xs font-semibold text-slate-600 uppercase">Action</span>
                  </div>
                </div>
                <div className="space-y-3">
                  {invoiceItems.map((item, index) => (
                    <div key={index} className="grid grid-cols-12 gap-3 items-start">
                      {/* Product Name */}
                      <div className="col-span-4 relative">
                        <input
                          type="text"
                          placeholder="🔍 Search product"
                          value={item.product_name}
                          onChange={(e) => handleProductSearch(index, e.target.value)}
                          onFocus={() => {
                            if (item.product_name) handleProductSearch(index, item.product_name);
                          }}
                          className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
                        />
                        {showProductDropdown === index && filteredProducts.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                            {filteredProducts.map((product) => (
                              <button
                                key={product.product_id}
                                type="button"
                                onClick={() => selectProduct(index, product)}
                                className="w-full px-3 py-2 text-left text-sm text-slate-900 hover:bg-slate-100 border-b last:border-b-0"
                              >
                                <div className="font-medium">{product.product_name}</div>
                                <div className="text-xs text-slate-500">Unit Cost: ₹{product.unit_cost}</div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Quantity */}
                      <div className="col-span-2">
                        <input
                          type="number"
                          min="1"
                          placeholder="Qty"
                          value={item.quantity}
                          onChange={(e) => {
                            const qty = parseInt(e.target.value) || 1;
                            const updated = [...invoiceItems];
                            updated[index] = { 
                              ...updated[index], 
                              quantity: qty,
                              total_cost: qty * updated[index].unit_cost
                            };
                            setInvoiceItems(updated);
                          }}
                          className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
                        />
                      </div>

                      {/* Unit Cost */}
                      <div className="col-span-2">
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Unit Cost"
                          value={item.unit_cost}
                          readOnly
                          className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900 bg-slate-50"
                        />
                      </div>

                      {/* Total Cost */}
                      <div className="col-span-2">
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Total"
                          value={item.total_cost.toFixed(2)}
                          readOnly
                          className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900 bg-slate-50"
                        />
                      </div>

                      {/* Delete Button */}
                      <div className="col-span-2">
                        <button
                          type="button"
                          onClick={() => removeInvoiceItem(index)}
                          disabled={invoiceItems.length === 1}
                          className={`w-full px-3 py-2 border rounded text-sm font-medium ${
                            invoiceItems.length === 1
                              ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                              : "bg-white text-red-600 border-red-300 hover:bg-red-50"
                          }`}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addInvoiceItem}
                  className="mt-3 text-sm text-slate-900 hover:text-slate-700 font-medium flex items-center gap-1"
                >
                  <span className="text-lg">+</span> Add item
                </button>
              </div>

              {/* Grand Total */}
              <div className="border-t pt-4">
                <div className="flex justify-end items-center gap-3">
                  <span className="text-lg font-semibold text-slate-900">Grand Total:</span>
                  <span className="text-2xl font-bold text-slate-900">₹{calculateGrandTotal().toFixed(2)}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => { setIsModalOpen(false); resetModal(); }}
                  disabled={isSubmitting}
                  className="px-6 py-2 border border-slate-300 rounded text-slate-900 hover:bg-slate-50 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2 bg-slate-700 text-white rounded hover:bg-slate-800 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isSubmitting && (
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  )}
                  {isSubmitting ? "Creating..." : "Create Invoice"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Preview Invoice Modal */}
      {isPreviewOpen && selectedInvoice && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">Invoice Details</h2>
              <button
                onClick={() => { setIsPreviewOpen(false); setSelectedInvoice(null); }}
                className="text-slate-400 hover:text-slate-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Invoice Header */}
              <div className="grid grid-cols-2 gap-6 pb-6 border-b">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Invoice Number</label>
                  <p className="text-lg font-bold text-slate-900">{selectedInvoice.invoice_number}</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Supplier Name</label>
                  <p className="text-lg font-semibold text-slate-900">{selectedInvoice.supplier_name}</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Created Date</label>
                  <p className="text-sm text-slate-700">{formatDate(selectedInvoice.created_at)}</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Delivered Date</label>
                  <p className="text-sm text-slate-700">{formatDate(selectedInvoice.received_date)}</p>
                </div>
              </div>

              {/* Invoice Items */}
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Invoice Items</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full border border-slate-200">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">S.No</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Product Name</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase tracking-wider">Quantity</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase tracking-wider">Unit Cost</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase tracking-wider">Total Cost</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                      {selectedInvoice.items.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-sm text-slate-700">{idx + 1}</td>
                          <td className="px-4 py-3 text-sm font-medium text-slate-900">{item.product_name}</td>
                          <td className="px-4 py-3 text-sm text-slate-700 text-right">{item.quantity}</td>
                          <td className="px-4 py-3 text-sm text-slate-700 text-right">₹{item.unit_cost.toFixed(2)}</td>
                          <td className="px-4 py-3 text-sm font-semibold text-slate-900 text-right">₹{item.total_cost.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Total Amount */}
              <div className="border-t pt-4">
                <div className="flex justify-end items-center gap-4">
                  <span className="text-lg font-semibold text-slate-900">Total Amount:</span>
                  <span className="text-2xl font-bold text-slate-900">₹{selectedInvoice.total_amount.toFixed(2)}</span>
                </div>
              </div>

              {/* Close Button */}
              <div className="flex justify-end pt-4">
                <button
                  onClick={() => { setIsPreviewOpen(false); setSelectedInvoice(null); }}
                  className="px-6 py-2 bg-slate-700 text-white rounded hover:bg-slate-800 text-sm font-medium"
                >
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
