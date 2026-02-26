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

type LendingRecord = {
  id: number;
  borrower_name: string;
  borrower_type: string;
  department: string;
  product_name: string;
  product_id: string | null;
  original_quantity: number;   // total initially borrowed
  quantity: number;            // current remaining (outstanding or returned)
  damaged_quantity: number;    // items marked damaged
  lost_quantity: number;       // items marked lost
  lending_date: string;
  due_date: string;
  return_date: string | null;
  status: string;
  mentor: string;
};

type LendingItem = {
  product_id: string;
  product_name: string;
  quantity: number;
};

type Department = {
  department_id: string;
  department_name: string;
};

type Product = {
  product_id: string;
  product_name: string;
  returnable: boolean;
};

type Staff = {
  staff_id: string;
  name: string;
};

export default function LendingPage() {
  const [records, setRecords] = useState<LendingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState("Monthly");
  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Modal form states
  const [borrowerType, setBorrowerType] = useState<"STUDENT" | "STAFF">("STUDENT");
  const [borrowerName, setBorrowerName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [lendingItems, setLendingItems] = useState<LendingItem[]>([{ product_id: "", product_name: "", quantity: 1 }]);
  const [lendingDate, setLendingDate] = useState(new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState("");
  const [project, setProject] = useState("");
  const [mentorStaffId, setMentorStaffId] = useState("");
  const [itemType, setItemType] = useState<"returnable" | "consumable">("returnable");
  const [products, setProducts] = useState<Product[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [showProductDropdown, setShowProductDropdown] = useState<number | null>(null);
  const [editingReturnDate, setEditingReturnDate] = useState<number | null>(null);
  const [stockErrors, setStockErrors] = useState<{ [key: number]: string }>({});
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editFormData, setEditFormData] = useState<Partial<LendingRecord>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Damage-related state
  const [damagedRowIdx, setDamagedRowIdx] = useState<number | null>(null);
  const [damagedQtyStr, setDamagedQtyStr] = useState<string>("1");
  const [damageLoading, setDamageLoading] = useState(false);

  // Lost-related state
  const [lostRowIdx, setLostRowIdx] = useState<number | null>(null);
  const [lostQtyStr, setLostQtyStr] = useState<string>("1");
  const [lostLoading, setLostLoading] = useState(false);

  // Return-from-dropdown modal state
  const [returnPickerRowIdx, setReturnPickerRowIdx] = useState<number | null>(null);
  const [returnPickerDate, setReturnPickerDate] = useState<string>("");
  const [returnPickerQty, setReturnPickerQty] = useState<number>(1);
  const [returnPickerLoading, setReturnPickerLoading] = useState(false);

  // Stats
  const [totalLent, setTotalLent] = useState(0);
  const [totalQuantity, setTotalQuantity] = useState(0);
  const [returned, setReturned] = useState(0);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    fetchLendingRecords();
    fetchDepartments();
    fetchProducts();
    fetchStaffList();
  }, [timeFilter]);

  async function fetchDepartments() {
    try {
      const res = await fetch("/api/departments");
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
      const res = await fetch("/api/products");
      if (res.ok) {
        const data = await res.json();
        setProducts(data || []);
      }
    } catch (error) {
      console.error("Error fetching products:", error);
    }
  }

  async function fetchStaffList() {
    try {
      const res = await fetch("/api/staffs");
      if (res.ok) {
        const data = await res.json();
        setStaffList(data || []);
      }
    } catch (error) {
      console.error("Error fetching staff list:", error);
    }
  }

  async function fetchLendingRecords() {
    try {
      setLoading(true);
      const res = await fetch(`/api/lending?period=${timeFilter.toLowerCase()}`);
      if (res.ok) {
        const data = await res.json();
        const fetched = data.records || [];
        setRecords(fetched);
        applyStats(fetched);
      } else {
        console.error("Failed to fetch lending records");
      }
    } catch (error) {
      console.error("Error fetching lending records:", error);
    } finally {
      setLoading(false);
    }
  }

  // Recalculate header stats from a records array without a full fetch
  const FINAL_STATUSES = ["RETURNED", "RETURNED_DAMAGED", "RETURNED_LOST", "DAMAGED", "LOST", "CONSUMABLE"];

  const applyStats = (recs: LendingRecord[]) => {
    const active = recs.filter(r => !FINAL_STATUSES.includes(r.status));
    setTotalLent(new Set(active.map(r => r.product_name).filter(n => n !== "—")).size);
    setTotalQuantity(active.reduce((s, r) => s + (r.quantity || 0), 0));
    setReturned(recs.filter(r => r.status === "RETURNED" || r.status === "RETURNED_DAMAGED" || r.status === "RETURNED_LOST").length);
    setPending(recs.filter(r =>
      r.status === "PENDING" ||
      r.status === "PARTIALLY_RETURNED" ||
      r.status === "PARTIALLY_DAMAGED" ||
      r.status === "PARTIALLY_LOST"
    ).length);
  };

  const filteredRecords = records
    .filter((record) => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        record.borrower_name?.toLowerCase().includes(query) ||
        record.department?.toLowerCase().includes(query) ||
        record.product_name?.toLowerCase().includes(query) ||
        record.status?.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => new Date(b.lending_date).getTime() - new Date(a.lending_date).getTime());

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this lending record?")) return;
    const prevRecords = records;
    const updated = records.filter(r => r.id !== id);
    setRecords(updated);
    applyStats(updated);
    try {
      const res = await fetch(`/api/lending/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setRecords(prevRecords);
        applyStats(prevRecords);
        console.error("Failed to delete record");
      }
    } catch (error) {
      setRecords(prevRecords);
      applyStats(prevRecords);
      console.error("Error deleting record:", error);
    }
  };

  const handleEdit = (record: LendingRecord, index: number) => {
    setEditingRow(index);
    setEditFormData({
      id: record.id,
      quantity: record.quantity,
      due_date: record.due_date,
      mentor: record.mentor,
    });
  };

  const handleCancelEdit = () => {
    setEditingRow(null);
    setEditFormData({});
  };

  const handleMarkDamaged = async (record: LendingRecord) => {
    if (!record.product_id) {
      alert("This record has no associated product and cannot be marked as damaged.");
      return;
    }
    const damagedQty = parseInt(damagedQtyStr) || 0;
    if (damagedQty < 1 || damagedQty > record.quantity) {
      alert(`Damaged quantity must be between 1 and ${record.quantity}`);
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
      const res = await fetch(`/api/lending/${record.id}/damage`, {
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
        alert(data.error || "Failed to mark items as damaged");
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
      alert("This record has no associated product and cannot be marked as lost.");
      return;
    }
    const lostQty = parseInt(lostQtyStr) || 0;
    if (lostQty < 1 || lostQty > record.quantity) {
      alert(`Lost quantity must be between 1 and ${record.quantity}`);
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
      const res = await fetch(`/api/lending/${record.id}/lost`, {
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
        alert(data.error || "Failed to mark items as lost");
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
    const prevRecords = records;
    const updated = records.map(r =>
      r.id === editFormData.id
        ? { ...r, quantity: editFormData.quantity ?? r.quantity, due_date: editFormData.due_date ?? r.due_date }
        : r
    );
    setRecords(updated);
    applyStats(updated);
    setEditingRow(null);
    setEditFormData({});
    try {
      const res = await fetch(`/api/lending/${editFormData.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity: editFormData.quantity,
          due_date: editFormData.due_date,
        }),
      });
      if (!res.ok) {
        setRecords(prevRecords);
        applyStats(prevRecords);
        console.error("Failed to update record");
      }
    } catch (error) {
      setRecords(prevRecords);
      applyStats(prevRecords);
      console.error("Error updating record:", error);
    }
  };

  const addLendingItem = () => {
    setLendingItems([...lendingItems, { product_id: "", product_name: "", quantity: 1 }]);
  };

  const removeLendingItem = (index: number) => {
    if (lendingItems.length === 1) return;
    setLendingItems(lendingItems.filter((_, i) => i !== index));
  };

  const updateLendingItem = (index: number, field: keyof LendingItem, value: any) => {
    const updated = [...lendingItems];
    updated[index] = { ...updated[index], [field]: value };
    setLendingItems(updated);
    
    // Check stock when quantity changes
    if (field === "quantity" && updated[index].product_id) {
      checkStock(index, updated[index].product_id, value);
    }
  };

  const checkStock = async (index: number, productId: string, requestedQuantity: number) => {
    try {
      const res = await fetch(`/api/stocks/${productId}`);
      if (res.ok) {
        const data = await res.json();
        const availableStock = data.quantity || 0;
        
        if (requestedQuantity > availableStock) {
          setStockErrors(prev => ({
            ...prev,
            [index]: `Insufficient stock. Available: ${availableStock}`
          }));
        } else {
          setStockErrors(prev => {
            const updated = { ...prev };
            delete updated[index];
            return updated;
          });
        }
      }
    } catch (error) {
      console.error("Error checking stock:", error);
    }
  };

  const handleProductSearch = (index: number, query: string) => {
    setProductSearchQuery(query);
    updateLendingItem(index, "product_name", query);
    setShowProductDropdown(index);
  };

  const selectProduct = (index: number, product: Product) => {
    // Update both fields at once
    const updated = [...lendingItems];
    updated[index] = { 
      ...updated[index], 
      product_id: product.product_id,
      product_name: product.product_name 
    };
    setLendingItems(updated);
    
    // Check stock availability for current quantity
    checkStock(index, product.product_id, updated[index].quantity);
    
    setShowProductDropdown(null);
    setProductSearchQuery("");
  };

  const filteredProducts = products.filter((p) =>
    p.product_name?.toLowerCase().includes(productSearchQuery.toLowerCase())
  );

  const resetModal = () => {
    setBorrowerName("");
    setDepartmentId("");
    setLendingItems([{ product_id: "", product_name: "", quantity: 1 }]);
    setLendingDate(new Date().toISOString().split("T")[0]);
    setDueDate("");
    setProject("");
    setMentorStaffId("");
    setItemType("returnable");
    setProductSearchQuery("");
    setShowProductDropdown(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Prevent double submission
    if (isSubmitting) return;
    
    // Check if there are any stock errors
    if (Object.keys(stockErrors).length > 0) {
      alert("Please resolve stock availability issues before submitting.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/lending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          borrower_type: borrowerType,
          borrower_name: borrowerName,
          department_id: departmentId,
          lending_items: lendingItems.filter(item => item.product_id && item.quantity > 0),
          lending_date: lendingDate,
          due_date: itemType === "returnable" ? dueDate : null,
          project_name: project,
          mentor_staff_id: mentorStaffId || null,
          status: itemType === "returnable" ? "PENDING" : "CONSUMABLE",
        }),
      });

      if (res.ok) {
        await fetchLendingRecords();
        setIsModalOpen(false);
        resetModal();
      } else {
        console.error("Failed to create lending entry");
      }
    } catch (error) {
      console.error("Error creating lending entry:", error);
    } finally {
      setIsSubmitting(false);
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
      const res = await fetch(`/api/lending/${recordId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setRecords(prevRecords);
        applyStats(prevRecords);
        console.error("Failed to update return date");
      }
    } catch (error) {
      setRecords(prevRecords);
      applyStats(prevRecords);
      console.error("Error updating return date:", error);
    }
  };

  if (loading) return (
    <div style={{ padding: 32, color: 'var(--muted)', fontSize: 13 }}>Loading lending records...</div>
  );

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 28px' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Lending Management</div>
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

      {/* Search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search by name, product, department..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: 1, padding: '6px 10px', fontSize: 12, border: '1px solid var(--border)', color: 'var(--fg)', background: '#fff', outline: 'none' }}
        />
      </div>

      {/* Table */}
      <div style={{ background: '#fff', border: '1px solid var(--border)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--surface)' }}>
              {['#', 'Borrower Name', 'Type', 'Dept', 'Product', 'Borrowed', 'Returned', 'Damaged', 'Lost', 'Balance', 'Lent Date', 'Due Date', 'Return Date', 'Status', 'Mentor', 'Actions'].map((h) => (
                <th key={h} style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRecords.length === 0 ? (
              <tr>
                <td colSpan={16} style={{ padding: '32px 10px', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>No lending records found</td>
              </tr>
            ) : (
              filteredRecords.map((record, idx) => (
                <tr key={`${record.id}-${record.product_id ?? 'none'}-${idx}`} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '7px 10px', color: 'var(--muted)' }}>{idx + 1}</td>
                  <td style={{ padding: '7px 10px', color: 'var(--fg)', whiteSpace: 'nowrap' }}>{record.borrower_name || '—'}</td>
                  <td style={{ padding: '7px 10px' }}>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', background: record.borrower_type === 'STUDENT' ? '#dbeafe' : '#ede9fe', color: record.borrower_type === 'STUDENT' ? '#1e40af' : '#6d28d9', letterSpacing: '0.04em' }}>
                      {record.borrower_type || '—'}
                    </span>
                  </td>
                  <td style={{ padding: '7px 10px', color: 'var(--fg)' }}>{record.department || '—'}</td>
                  <td style={{ padding: '7px 10px', color: 'var(--fg)', whiteSpace: 'nowrap' }}>{record.product_name || '—'}</td>
                  {/* Quantity breakdown */}
                  {(() => {
                    const FULLY_RETURNED_STATUSES = ['RETURNED', 'RETURNED_DAMAGED', 'RETURNED_LOST'];
                    const borrowed   = record.original_quantity ?? record.quantity;
                    const damaged    = record.damaged_quantity ?? 0;
                    const lost       = record.lost_quantity ?? 0;
                    const currentQty = record.quantity;
                    const isFullyReturned = FULLY_RETURNED_STATUSES.includes(record.status);
                    const retd = isFullyReturned
                      ? Math.max(0, borrowed - damaged - lost)
                      : Math.max(0, borrowed - currentQty - damaged - lost);
                    const balance = isFullyReturned ? 0 : currentQty;
                    const qCell = (v: number, color: string) => (
                      <td style={{ padding: '7px 10px', textAlign: 'center', color: v > 0 ? color : 'var(--muted)', fontWeight: v > 0 ? 600 : 400 }}>{v > 0 ? v : '—'}</td>
                    );
                    return (
                      <>
                        <td style={{ padding: '7px 10px', textAlign: 'center', color: 'var(--fg)' }}>
                          {editingRow === idx ? (
                            <input
                              type="number" min="1"
                              value={editFormData.quantity || record.quantity}
                              onChange={(e) => setEditFormData({ ...editFormData, quantity: parseInt(e.target.value) || 1 })}
                              style={{ width: 52, padding: '2px 6px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)' }}
                            />
                          ) : borrowed}
                        </td>
                        {qCell(retd, '#16a34a')}
                        {qCell(damaged, '#dc2626')}
                        {qCell(lost, '#d97706')}
                        {qCell(balance, '#92400e')}
                      </>
                    );
                  })()}
                  <td style={{ padding: '7px 10px', color: 'var(--fg)', whiteSpace: 'nowrap' }}>{formatDate(record.lending_date)}</td>
                  <td style={{ padding: '7px 10px', color: 'var(--fg)', whiteSpace: 'nowrap' }}>
                    {editingRow === idx ? (
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
                    ) : (
                      <button
                        onClick={() => { setReturnPickerRowIdx(idx); setReturnPickerDate(new Date().toISOString().split('T')[0]); setReturnPickerQty(record.quantity); }}
                        title="Set return date"
                        style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, textDecoration: 'underline', padding: 0 }}
                      >
                        Set Date
                      </button>
                    )}
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    {(['PENDING', 'PARTIALLY_RETURNED', 'PARTIALLY_DAMAGED', 'PARTIALLY_LOST'].includes(record.status)) ? (
                      <select
                        value={record.status}
                        onChange={(e) => {
                          if (e.target.value === 'DO_DAMAGED') { setDamagedRowIdx(idx); setDamagedQtyStr('1'); }
                          else if (e.target.value === 'DO_LOST') { setLostRowIdx(idx); setLostQtyStr('1'); }
                          else if (e.target.value === 'DO_RETURN') { setReturnPickerRowIdx(idx); setReturnPickerDate(new Date().toISOString().split('T')[0]); setReturnPickerQty(record.quantity); }
                        }}
                        style={{ fontSize: 11, fontWeight: 600, padding: '2px 6px', border: '1px solid var(--border)', background: '#fff', color: 'var(--fg)', cursor: 'pointer' }}
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
                  <td style={{ padding: '7px 10px', color: 'var(--fg)' }}>{record.mentor || '—'}</td>
                  <td style={{ padding: '7px 10px' }}>
                    {editingRow === idx ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={handleSaveEdit} style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, background: '#16a34a', color: '#fff', border: 'none', cursor: 'pointer' }}>Save</button>
                        <button onClick={handleCancelEdit} style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, background: 'var(--surface)', color: 'var(--fg)', border: '1px solid var(--border)', cursor: 'pointer' }}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => handleEdit(record, idx)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Edit</button>
                        <button onClick={() => handleDelete(record.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Del</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
                  onClick={async () => { if (!returnPickerDate) { alert('Please select a return date.'); return; } setReturnPickerLoading(true); await handleReturnDateUpdate(rec.id, rec.product_id, returnPickerDate, returnPickerQty); setReturnPickerLoading(false); }}
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
          <div style={{ background: '#fff', border: '1px solid var(--border)', padding: 24, width: '100%', maxWidth: 720 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Add New Entry</div>
              <button onClick={() => { setIsModalOpen(false); resetModal(); }} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
            </div>

            <form onSubmit={handleSubmit}>
              {/* Borrower Type + Item Type */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ display: 'flex', border: '1px solid var(--border)' }}>
                  {(['STUDENT', 'STAFF'] as const).map((t) => (
                    <button key={t} type="button" onClick={() => setBorrowerType(t)}
                      style={{ padding: '5px 18px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: borrowerType === t ? 'var(--accent)' : '#fff', color: borrowerType === t ? '#fff' : 'var(--fg)' }}>
                      {t === 'STUDENT' ? 'Student' : 'Staff'}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 20 }}>
                  {(['returnable', 'consumable'] as const).map((t) => (
                    <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--fg)' }}>
                      <input type="radio" name="itemType" checked={itemType === t} onChange={() => setItemType(t)} />
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </label>
                  ))}
                </div>
              </div>

              {/* Name & Department */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{borrowerType === 'STUDENT' ? 'Student Name' : 'Staff Name'}</div>
                  <input type="text" required value={borrowerName} onChange={(e) => setBorrowerName(e.target.value)} placeholder={`Enter ${borrowerType === 'STUDENT' ? 'student' : 'staff'} name`}
                    style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', boxSizing: 'border-box' as const }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Department</div>
                  <select required value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}
                    style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', background: '#fff', boxSizing: 'border-box' as const }}>
                    <option value="">Select department</option>
                    {departments.map((dept) => (
                      <option key={dept.department_id} value={dept.department_id}>{dept.department_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Lending Items */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Lending Items</div>
                {lendingItems.map((item, index) => (
                  <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 80px', gap: 8, marginBottom: 8, alignItems: 'start' }}>
                    <div style={{ position: 'relative' }}>
                      <input type="text" placeholder="Search item..." value={item.product_name}
                        onChange={(e) => handleProductSearch(index, e.target.value)}
                        onFocus={() => setShowProductDropdown(index)}
                        style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', boxSizing: 'border-box' as const }} />
                      {showProductDropdown === index && filteredProducts.length > 0 && (
                        <div style={{ position: 'absolute', zIndex: 10, width: '100%', background: '#fff', border: '1px solid var(--border)', maxHeight: 180, overflowY: 'auto', top: '100%', left: 0 }}>
                          {filteredProducts.map((product) => (
                            <button key={product.product_id} type="button" onClick={() => selectProduct(index, product)}
                              style={{ display: 'block', width: '100%', padding: '6px 10px', textAlign: 'left', fontSize: 12, color: 'var(--fg)', background: 'none', border: 'none', cursor: 'pointer' }}>
                              {product.product_name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <input type="number" min="1" placeholder="Qty" value={item.quantity}
                        onChange={(e) => updateLendingItem(index, 'quantity', parseInt(e.target.value) || 1)}
                        style={{ width: '100%', padding: '5px 8px', border: stockErrors[index] ? '1px solid #dc2626' : '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', boxSizing: 'border-box' as const }} />
                      {stockErrors[index] && <div style={{ fontSize: 10, color: '#dc2626', marginTop: 2 }}>{stockErrors[index]}</div>}
                    </div>
                    <button type="button" onClick={() => removeLendingItem(index)} disabled={lendingItems.length === 1}
                      style={{ padding: '5px 8px', fontSize: 11, border: '1px solid var(--border)', background: lendingItems.length === 1 ? 'var(--surface)' : '#fff', color: lendingItems.length === 1 ? 'var(--muted)' : '#dc2626', cursor: lendingItems.length === 1 ? 'not-allowed' : 'pointer' }}>
                      Remove
                    </button>
                  </div>
                ))}
                <button type="button" onClick={addLendingItem}
                  style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  + Add item
                </button>
              </div>

              {/* Dates */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Lending Date</div>
                  <input type="date" required value={lendingDate} onChange={(e) => setLendingDate(e.target.value)}
                    style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', boxSizing: 'border-box' as const }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Expected Return Date</div>
                  <input type="date" required={itemType === 'returnable'} disabled={itemType === 'consumable'} value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                    style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: itemType === 'consumable' ? 'var(--muted)' : 'var(--fg)', background: itemType === 'consumable' ? 'var(--surface)' : '#fff', boxSizing: 'border-box' as const }} />
                </div>
              </div>

              {/* Project & Mentor */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Project</div>
                  <input type="text" value={project} onChange={(e) => setProject(e.target.value)} placeholder="Enter project name"
                    style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', boxSizing: 'border-box' as const }} />
                </div>
                {borrowerType === 'STUDENT' && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Mentor</div>
                    <select value={mentorStaffId} onChange={(e) => setMentorStaffId(e.target.value)}
                      style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', background: '#fff', boxSizing: 'border-box' as const }}>
                      <option value="">Select mentor</option>
                      {staffList.map((staff) => (
                        <option key={staff.staff_id} value={staff.staff_id}>{staff.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <button type="button" onClick={() => { setIsModalOpen(false); resetModal(); }}
                  style={{ padding: '5px 18px', fontSize: 12, border: '1px solid var(--border)', background: '#fff', color: 'var(--fg)', cursor: 'pointer' }}>Cancel</button>
                <button type="submit" disabled={isSubmitting}
                  style={{ padding: '5px 18px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', opacity: isSubmitting ? 0.5 : 1 }}>
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
