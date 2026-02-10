"use client";

import { useEffect, useState } from "react";

type LendingRecord = {
  id: number;
  borrower_name: string;
  department: string;
  product_name: string;
  quantity: number;
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

  // Stats
  const [totalLent, setTotalLent] = useState(0);
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
        setRecords(data.records || []);
        setTotalLent(data.stats?.totalLent || 0);
        setReturned(data.stats?.returned || 0);
        setPending(data.stats?.pending || 0);
      } else {
        console.error("Failed to fetch lending records");
      }
    } catch (error) {
      console.error("Error fetching lending records:", error);
    } finally {
      setLoading(false);
    }
  }

  const filteredRecords = records.filter((record) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      record.borrower_name?.toLowerCase().includes(query) ||
      record.department?.toLowerCase().includes(query) ||
      record.product_name?.toLowerCase().includes(query) ||
      record.status?.toLowerCase().includes(query)
    );
  });

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this lending record?")) return;
    
    try {
      const res = await fetch(`/api/lending/${id}`, { method: "DELETE" });
      if (res.ok) {
        setRecords(records.filter((r) => r.id !== id));
      }
    } catch (error) {
      console.error("Error deleting record:", error);
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
  };

  const handleProductSearch = (index: number, query: string) => {
    setProductSearchQuery(query);
    updateLendingItem(index, "product_name", query);
    setShowProductDropdown(index);
  };

  const selectProduct = (index: number, product: Product) => {
    updateLendingItem(index, "product_id", product.product_id);
    updateLendingItem(index, "product_name", product.product_name);
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
              <h2 className="text-3xl font-bold text-slate-800">{totalLent}</h2>
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
            className="w-full px-4 py-2 border rounded text-sm"
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
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Dept</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Product Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Quantity</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Date of lending</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Due Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Return Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Mentor</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-slate-500">
                    No lending records found
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record, idx) => (
                  <tr key={record.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm text-slate-700">{idx + 1}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{record.borrower_name || "—"}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{record.department || "—"}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{record.product_name || "—"}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{record.quantity || 0}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {record.lending_date ? new Date(record.lending_date).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {record.due_date ? new Date(record.due_date).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {record.return_date ? new Date(record.return_date).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          record.status === "RETURNED"
                            ? "bg-green-100 text-green-800"
                            : record.status === "PENDING"
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {record.status || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">{record.mentor || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {/* Edit functionality */}}
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
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

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
                        className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500 placeholder:text-slate-600"
                      />
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
                  className="px-6 py-2 bg-slate-700 text-white rounded hover:bg-slate-800 text-sm font-medium"
                >
                  Save changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
