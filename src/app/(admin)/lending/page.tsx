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

  if (loading) return <div className="p-6">Loading lending records...</div>;

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Lending management</h1>
        <div className="flex items-center gap-3">
          <select
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value)}
            className="px-4 py-2 border rounded bg-slate-600 text-white text-sm"
          >
            <option>Daily</option>
            <option>Weekly</option>
            <option>Monthly</option>
            <option>Yearly</option>
          </select>
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2 bg-slate-600 text-white rounded text-sm"
          >
            + Add entry
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-5 border">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-slate-500 mb-1">Total lent products</p>
              <h2 className="text-3xl font-bold text-slate-800">
                {totalLent} <span className="text-xl text-slate-600">({totalQuantity})</span>
              </h2>
              <p className="text-xs text-green-600 mt-1">↑ 12% from last week</p>
            </div>
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-5 border">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-slate-500 mb-1">Returned</p>
              <h2 className="text-3xl font-bold text-slate-800">{returned}</h2>
              <p className="text-xs text-red-600 mt-1">↓ 5% from last week</p>
            </div>
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-5 border">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-slate-500 mb-1">Pending</p>
              <h2 className="text-3xl font-bold text-slate-800">{pending}</h2>
              <p className="text-xs text-green-600 mt-1">↑ 3% from last week</p>
            </div>
            <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 border rounded text-sm text-slate-900 placeholder:text-slate-500"
          />
        </div>
        <button className="flex items-center gap-2 px-4 py-2 border rounded bg-white text-slate-700 text-sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
          </svg>
          Sort
        </button>
        <button className="flex items-center gap-2 px-4 py-2 border rounded bg-slate-700 text-white text-sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Filter
        </button>
        <button className="flex items-center gap-2 px-4 py-2 border rounded bg-white text-slate-700 text-sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
        <button className="flex items-center gap-2 px-4 py-2 border rounded bg-white text-slate-700 text-sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-slate-700 text-white">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">S.No</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Borrower Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Borrower</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Dept</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Product Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">No. of Borrowed</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">No. Returned</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">No. Damaged</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">No. Lost</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Balance</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Date of Lending</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Due Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Return Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Mentor</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={16} className="px-4 py-8 text-center text-slate-500">
                    No lending records found
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record, idx) => (
                  <tr key={`${record.id}-${record.product_id ?? 'none'}-${idx}`} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm text-slate-700">{idx + 1}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{record.borrower_name || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        record.borrower_type === "STUDENT" 
                          ? "bg-blue-100 text-blue-800" 
                          : "bg-purple-100 text-purple-800"
                      }`}>
                        {record.borrower_type || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">{record.department || "—"}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{record.product_name || "—"}</td>
                    {/* ── Quantity breakdown columns ── */}
                    {(() => {
                      const FULLY_RETURNED_STATUSES = ["RETURNED", "RETURNED_DAMAGED", "RETURNED_LOST"];
                      const borrowed   = record.original_quantity ?? record.quantity;
                      const damaged    = record.damaged_quantity ?? 0;
                      const lost       = record.lost_quantity ?? 0;
                      const currentQty = record.quantity; // remaining outstanding items
                      const isFullyReturned = FULLY_RETURNED_STATUSES.includes(record.status);
                      // For fully-returned rows, derive returned from original minus damaged/lost
                      // (works regardless of whether DB quantity stores remaining or returned count)
                      const returned   = isFullyReturned
                        ? Math.max(0, borrowed - damaged - lost)
                        : Math.max(0, borrowed - currentQty - damaged - lost);
                      const balance    = isFullyReturned ? 0 : currentQty;
                      return (
                        <>
                          {/* No. of Borrowed */}
                          <td className="px-4 py-3 text-sm text-slate-700 text-center">
                            {editingRow === idx ? (
                              <input
                                type="number"
                                min="1"
                                value={editFormData.quantity || record.quantity}
                                onChange={(e) => setEditFormData({ ...editFormData, quantity: parseInt(e.target.value) || 1 })}
                                className="w-16 px-2 py-1 border border-slate-300 rounded text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
                              />
                            ) : borrowed}
                          </td>
                          {/* No. Returned */}
                          <td className="px-4 py-3 text-sm text-center">
                            <span className={returned > 0 ? "font-semibold text-green-700" : "text-slate-400"}>
                              {returned > 0 ? returned : "—"}
                            </span>
                          </td>
                          {/* No. Damaged */}
                          <td className="px-4 py-3 text-sm text-center">
                            <span className={damaged > 0 ? "font-semibold text-red-600" : "text-slate-400"}>
                              {damaged > 0 ? damaged : "—"}
                            </span>
                          </td>
                          {/* No. Lost */}
                          <td className="px-4 py-3 text-sm text-center">
                            <span className={lost > 0 ? "font-semibold text-orange-600" : "text-slate-400"}>
                              {lost > 0 ? lost : "—"}
                            </span>
                          </td>
                          {/* Balance */}
                          <td className="px-4 py-3 text-sm text-center">
                            <span className={balance > 0 ? "font-semibold text-yellow-700" : "text-slate-400"}>
                              {balance > 0 ? balance : "—"}
                            </span>
                          </td>
                        </>
                      );
                    })()}
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatDate(record.lending_date)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {editingRow === idx ? (
                        <input
                          type="date"
                          value={editFormData.due_date || record.due_date || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, due_date: e.target.value })}
                          className="px-2 py-1 border border-slate-300 rounded text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
                        />
                      ) : (
                        formatDate(record.due_date)
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {record.return_date ? (
                        formatDate(record.return_date)
                      ) : (
                        <button
                          onClick={() => {
                            setReturnPickerRowIdx(idx);
                            setReturnPickerDate(new Date().toISOString().split("T")[0]);
                            setReturnPickerQty(record.quantity);
                          }}
                          className="flex items-center gap-1 text-blue-600 hover:text-blue-800"
                          title="Set return date"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-5 w-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                            />
                          </svg>
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {(["PENDING", "PARTIALLY_RETURNED", "PARTIALLY_DAMAGED", "PARTIALLY_LOST"].includes(record.status)) ? (
                        <select
                          value={record.status}
                          onChange={(e) => {
                            if (e.target.value === "DO_DAMAGED") {
                              setDamagedRowIdx(idx);
                              setDamagedQtyStr("1");
                            } else if (e.target.value === "DO_LOST") {
                              setLostRowIdx(idx);
                              setLostQtyStr("1");
                            } else if (e.target.value === "DO_RETURN") {
                              setReturnPickerRowIdx(idx);
                              setReturnPickerDate(new Date().toISOString().split("T")[0]);
                              setReturnPickerQty(record.quantity);
                            }
                          }}
                          className={`px-2 py-1 text-xs font-semibold rounded border cursor-pointer focus:outline-none focus:ring-2 ${
                            record.status === "PARTIALLY_DAMAGED"
                              ? "border-red-400 bg-red-50 text-red-700 focus:ring-red-400"
                              : record.status === "PARTIALLY_LOST"
                              ? "border-orange-400 bg-orange-50 text-orange-700 focus:ring-orange-400"
                              : record.status === "PARTIALLY_RETURNED"
                              ? "border-blue-400 bg-blue-50 text-blue-700 focus:ring-blue-400"
                              : "border-yellow-400 bg-yellow-100 text-yellow-800 focus:ring-yellow-500"
                          }`}
                        >
                          <option value={record.status}>
                            {record.status === "PENDING"
                              ? "PENDING"
                              : record.status === "PARTIALLY_RETURNED"
                              ? "PARTIALLY RETURNED"
                              : record.status === "PARTIALLY_DAMAGED"
                              ? "PARTIALLY DAMAGED"
                              : "PARTIALLY LOST"}
                          </option>
                          <option value="DO_RETURN">Mark as Returned</option>
                          <option value="DO_DAMAGED">Mark as Damaged</option>
                          <option value="DO_LOST">Mark as Lost</option>
                        </select>
                      ) : (
                        (() => {
                          const d = record.damaged_quantity ?? 0;
                          const l = record.lost_quantity ?? 0;
                          const orig = (record.original_quantity != null && record.original_quantity > 0)
                            ? record.original_quantity
                            : record.quantity;
                          // Always compute returnedCount from quantities directly —
                          // this correctly handles DAMAGED / LOST / RETURNED_* statuses
                          // where some items were returned before the rest were marked damaged/lost.
                          const returnedCount = Math.max(0, orig - d - l);

                          const hasPills = returnedCount > 0 || d > 0 || l > 0;

                          if (hasPills) {
                            return (
                              <div className="flex flex-col gap-1">
                                {returnedCount > 0 && (
                                  <span className="inline-flex items-center justify-center px-3 py-1 text-xs font-semibold rounded-full bg-green-200 text-green-900 whitespace-nowrap">
                                    {returnedCount} Returned
                                  </span>
                                )}
                                {d > 0 && (
                                  <span className="inline-flex items-center justify-center px-3 py-1 text-xs font-semibold rounded-full bg-red-200 text-red-900 whitespace-nowrap">
                                    {d} Damaged
                                  </span>
                                )}
                                {l > 0 && (
                                  <span className="inline-flex items-center justify-center px-3 py-1 text-xs font-semibold rounded-full bg-[#c4a8a8] text-[#3b1f1f] whitespace-nowrap">
                                    {l} Lost
                                  </span>
                                )}
                              </div>
                            );
                          }

                          // Fallback for CONSUMABLE or any unhandled status
                          const fallbackColor =
                            record.status === "CONSUMABLE"
                              ? "bg-purple-100 text-purple-800"
                              : "bg-gray-100 text-gray-700";
                          return (
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full cursor-default ${fallbackColor}`}>
                              {record.status || "—"}
                            </span>
                          );
                        })()
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">{record.mentor || "—"}</td>
                    <td className="px-4 py-3">
                      {editingRow === idx ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleSaveEdit}
                            className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                            title="Save"
                          >
                            Save
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            className="px-3 py-1 text-xs bg-gray-400 text-white rounded hover:bg-gray-500"
                            title="Cancel"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleEdit(record, idx)}
                            className="p-1 text-blue-600 hover:text-blue-800"
                            title="Edit"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(record.id)}
                            className="p-1 text-red-600 hover:text-red-800"
                            title="Delete"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Return Date Modal */}
      {returnPickerRowIdx !== null && filteredRecords[returnPickerRowIdx] && (() => {
        const rec = filteredRecords[returnPickerRowIdx];
        const isPartiallyDamaged = rec.status === "PARTIALLY_DAMAGED";
        const isPartiallyLost = rec.status === "PARTIALLY_LOST";
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
              <h2 className="text-lg font-semibold text-slate-800 mb-1">Set Return Date</h2>
              <p className="text-sm text-slate-500 mb-1">
                Product: <span className="font-medium text-slate-700">{rec.product_name}</span>
              </p>
              {isPartiallyDamaged && (
                <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1 mb-3">
                  ⚠ {rec.damaged_quantity ?? 0} item{(rec.damaged_quantity ?? 0) !== 1 ? "s were" : " was"} damaged.
                  Returning the remaining {rec.quantity} item{rec.quantity !== 1 ? "s" : ""} → status will be <strong>Returned (Damaged)</strong>.
                </p>
              )}
              {isPartiallyLost && (
                <p className="text-xs text-orange-600 bg-orange-50 rounded px-2 py-1 mb-3">
                  ⚠ {rec.lost_quantity ?? 0} item{(rec.lost_quantity ?? 0) !== 1 ? "s were" : " was"} lost. Returning the remaining {rec.quantity} item{rec.quantity !== 1 ? "s" : ""} → status will be <strong>Returned (Lost)</strong>.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Return date</label>
                  <input
                    type="date"
                    value={returnPickerDate}
                    max={new Date().toISOString().split("T")[0]}
                    onChange={(e) => setReturnPickerDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Qty returned
                    <span className="text-slate-400 font-normal ml-1">(max {rec.quantity})</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={rec.quantity}
                    value={returnPickerQty}
                    onChange={(e) => setReturnPickerQty(Math.min(rec.quantity, Math.max(1, parseInt(e.target.value) || 1)))}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-400"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setReturnPickerRowIdx(null); setReturnPickerDate(""); setReturnPickerQty(1); }}
                  disabled={returnPickerLoading}
                  className="px-4 py-2 border border-slate-300 rounded text-sm text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!returnPickerDate) { alert("Please select a return date."); return; }
                    setReturnPickerLoading(true);
                    await handleReturnDateUpdate(rec.id, rec.product_id, returnPickerDate, returnPickerQty);
                    setReturnPickerLoading(false);
                  }}
                  disabled={returnPickerLoading || !returnPickerDate}
                  className="px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
                >
                  {returnPickerLoading ? "Saving..." : "Confirm Return"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Damage Confirmation Modal */}
      {damagedRowIdx !== null && filteredRecords[damagedRowIdx] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-lg font-semibold text-slate-800 mb-1">Mark Items as Damaged</h2>
            <p className="text-sm text-slate-500 mb-4">
              Product: <span className="font-medium text-slate-700">{filteredRecords[damagedRowIdx].product_name}</span>
              <br />
              Lent quantity: <span className="font-medium text-slate-700">{filteredRecords[damagedRowIdx].quantity}</span>
            </p>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Number of damaged items
            </label>
            <input
              type="number"
              min={1}
              max={filteredRecords[damagedRowIdx].quantity}
              value={damagedQtyStr}
              onChange={(e) => setDamagedQtyStr(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-400 mb-4"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setDamagedRowIdx(null); setDamagedQtyStr("1"); }}
                disabled={damageLoading}
                className="px-4 py-2 border border-slate-300 rounded text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleMarkDamaged(filteredRecords[damagedRowIdx])}
                disabled={damageLoading}
                className="px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50"
              >
                {damageLoading ? "Saving..." : "Confirm Damaged"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lost Confirmation Modal */}
      {lostRowIdx !== null && filteredRecords[lostRowIdx] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-lg font-semibold text-slate-800 mb-1">Mark Items as Lost</h2>
            <p className="text-sm text-slate-500 mb-4">
              Product: <span className="font-medium text-slate-700">{filteredRecords[lostRowIdx].product_name}</span>
              <br />
              Lent quantity: <span className="font-medium text-slate-700">{filteredRecords[lostRowIdx].quantity}</span>
            </p>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Number of lost items
            </label>
            <input
              type="number"
              min={1}
              max={filteredRecords[lostRowIdx].quantity}
              value={lostQtyStr}
              onChange={(e) => setLostQtyStr(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-400 mb-4"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setLostRowIdx(null); setLostQtyStr("1"); }}
                disabled={lostLoading}
                className="px-4 py-2 border border-slate-300 rounded text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleMarkLost(filteredRecords[lostRowIdx])}
                disabled={lostLoading}
                className="px-4 py-2 bg-orange-600 text-white rounded text-sm hover:bg-orange-700 disabled:opacity-50"
              >
                {lostLoading ? "Saving..." : "Confirm Lost"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Entry Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 w-[90%] max-w-3xl my-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-slate-800">Add new entry</h2>
              <button onClick={() => { setIsModalOpen(false); resetModal(); }} className="text-slate-500 text-2xl hover:text-slate-700">✕</button>
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Student/Staff Toggle & Returnable/Consumable Radio */}
              <div className="flex items-center justify-between">
                {/* Student/Staff Toggle */}
                <div className="inline-flex rounded-lg border border-slate-300 bg-slate-100">
                  <button
                    type="button"
                    onClick={() => setBorrowerType("STUDENT")}
                    className={`px-6 py-2 text-sm font-medium rounded-l-lg transition-colors ${
                      borrowerType === "STUDENT"
                        ? "bg-slate-700 text-white"
                        : "bg-transparent text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    Student
                  </button>
                  <button
                    type="button"
                    onClick={() => setBorrowerType("STAFF")}
                    className={`px-6 py-2 text-sm font-medium rounded-r-lg transition-colors ${
                      borrowerType === "STAFF"
                        ? "bg-slate-700 text-white"
                        : "bg-transparent text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    Staff
                  </button>
                </div>

                {/* Returnable/Consumable Radio */}
                <div className="flex items-center gap-6">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="itemType"
                      checked={itemType === "returnable"}
                      onChange={() => setItemType("returnable")}
                      className="w-4 h-4 text-slate-700 border-slate-300 focus:ring-slate-500"
                    />
                    <span className="text-sm font-medium text-slate-700">Returnable</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="itemType"
                      checked={itemType === "consumable"}
                      onChange={() => setItemType("consumable")}
                      className="w-4 h-4 text-slate-700 border-slate-300 focus:ring-slate-500"
                    />
                    <span className="text-sm font-medium text-slate-700">Consumable</span>
                  </label>
                </div>
              </div>

              {/* Student/Staff Name & Department */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-2">
                    {borrowerType === "STUDENT" ? "Student name" : "Staff name"}
                  </label>
                  <input
                    type="text"
                    required
                    value={borrowerName}
                    onChange={(e) => setBorrowerName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
                    placeholder={`Enter ${borrowerType} name`}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-2">Department</label>
                  <select
                    required
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                  >
                    <option value="">Select department</option>
                    {departments.map((dept) => (
                      <option key={dept.department_id} value={dept.department_id}>
                        {dept.department_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Lending Items Section */}
              <div className="border-t pt-4">
                <label className="block text-sm font-medium text-slate-900 mb-3">Lending Item</label>
                {lendingItems.map((item, index) => (
                  <div key={index} className="grid grid-cols-12 gap-3 mb-3 items-start">
                    <div className="col-span-7 relative">
                      <input
                        type="text"
                        placeholder="🔍 Enter item"
                        value={item.product_name}
                        onChange={(e) => handleProductSearch(index, e.target.value)}
                        onFocus={() => setShowProductDropdown(index)}
                        className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500 bg-slate-50 placeholder:text-slate-600"
                      />
                      {showProductDropdown === index && filteredProducts.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {filteredProducts.map((product) => (
                            <button
                              key={product.product_id}
                              type="button"
                              onClick={() => selectProduct(index, product)}
                              className="w-full px-4 py-2 text-left text-sm text-slate-900 hover:bg-slate-100 focus:bg-slate-100"
                            >
                              {product.product_name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="col-span-3">
                      <input
                        type="number"
                        min="1"
                        placeholder="Quantity"
                        value={item.quantity}
                        onChange={(e) => updateLendingItem(index, "quantity", parseInt(e.target.value) || 1)}
                        className={`w-full px-3 py-2 border rounded text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500 placeholder:text-slate-600 ${
                          stockErrors[index] ? "border-red-500" : "border-slate-300"
                        }`}
                      />
                      {stockErrors[index] && (
                        <p className="text-xs text-red-600 mt-1">{stockErrors[index]}</p>
                      )}
                    </div>
                    <div className="col-span-2">
                      <button
                        type="button"
                        onClick={() => removeLendingItem(index)}
                        disabled={lendingItems.length === 1}
                        className={`w-full px-3 py-2 border rounded text-sm font-medium ${
                          lendingItems.length === 1
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                            : "bg-white text-slate-900 border-slate-300 hover:bg-red-50 hover:text-red-600"
                        }`}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addLendingItem}
                  className="text-sm text-slate-900 hover:text-slate-700 font-medium flex items-center gap-1"
                >
                  <span className="text-lg">+</span> Add item
                </button>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-2">Lending date</label>
                  <input
                    type="date"
                    required
                    value={lendingDate}
                    onChange={(e) => setLendingDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-2">Expected date of return</label>
                  <input
                    type="date"
                    required={itemType === "returnable"}
                    disabled={itemType === "consumable"}
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className={`w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 ${
                      itemType === "consumable" ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "text-slate-900"
                    }`}
                  />
                </div>
              </div>

              {/* Project & Mentor */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-2">Project</label>
                  <input
                    type="text"
                    value={project}
                    onChange={(e) => setProject(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500 placeholder:text-slate-600"
                    placeholder="Enter project name"
                  />
                </div>
                {borrowerType === "STUDENT" && (
                  <div>
                    <label className="block text-sm font-medium text-slate-900 mb-2">Mentor</label>
                    <select
                      value={mentorStaffId}
                      onChange={(e) => setMentorStaffId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                    >
                      <option value="">Select mentor</option>
                      {staffList.map((staff) => (
                        <option key={staff.staff_id} value={staff.staff_id}>
                          {staff.name}
                        </option>
                    ))}
                  </select>
                </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => { setIsModalOpen(false); resetModal(); }}
                  className="px-6 py-2 border border-slate-300 rounded text-slate-900 hover:bg-slate-50 text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2 bg-slate-700 text-white rounded hover:bg-slate-800 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
