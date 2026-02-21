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
  
  // Stats
  const [totalBorrowed, setTotalBorrowed] = useState(0);
  const [returned, setReturned] = useState(0);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    fetchStaffRecords();
  }, [timeFilter]);

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
        alert(`Error: ${errorData.error || "Failed to fetch staff records"}`);
      }
    } catch (error) {
      console.error("Error fetching staff records:", error);
      alert(`Error: ${error}`);
    } finally {
      setLoading(false);
    }
  }

  const filteredRecords = records.filter((record) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      record.staff_name?.toLowerCase().includes(query) ||
      record.department?.toLowerCase().includes(query) ||
      record.product_name?.toLowerCase().includes(query) ||
      record.mobile?.toLowerCase().includes(query)
    );
  });

  if (loading) return <div className="p-6">Loading staff records...</div>;

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Staffs records</h1>
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
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-5 border">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-slate-500 mb-1">Total Borrowed</p>
              <h2 className="text-3xl font-bold text-slate-800">{totalBorrowed}</h2>
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
              <p className="text-xs text-yellow-600 mt-1">→ No change</p>
            </div>
            <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Search and Actions */}
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
        <button className="flex items-center gap-2 px-4 py-2 border rounded bg-white text-slate-700 text-sm hover:bg-slate-50">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
          </svg>
          Sort
        </button>
        <div className="flex border rounded">
          <button className="p-2 bg-slate-600 text-white">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>
          <button className="p-2 bg-white text-slate-600 hover:bg-slate-50">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 border rounded bg-white text-slate-700 text-sm hover:bg-slate-50">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Filter
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-slate-100 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">S.No</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Staff Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Dept</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Product Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Qty</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Borrow Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Return Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Mobile</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    No staff records found
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record, idx) => {
                  const initials = record.staff_name
                    ?.split(' ')
                    .map(n => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2) || '?';
                  
                  return (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm text-slate-700">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-purple-500 text-white rounded-full flex items-center justify-center text-xs font-semibold">
                            {initials}
                          </div>
                          <span className="text-sm font-medium text-slate-900">{record.staff_name || "—"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">{record.department || "—"}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{record.product_name || "—"}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{record.quantity || 0}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{formatDate(record.borrow_date)}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{formatDate(record.return_date)}</td>
                      <td className="px-4 py-3">
                        {(() => {
                          const PENDING_STATUSES = ["PENDING", "PARTIALLY_RETURNED", "PARTIALLY_DAMAGED", "PARTIALLY_LOST"];
                          const FINAL_RETURNED = ["RETURNED", "RETURNED_DAMAGED", "RETURNED_LOST"];
                          const d = record.damaged_quantity ?? 0;
                          const l = record.lost_quantity ?? 0;
                          const orig = record.original_quantity ?? record.quantity;

                          if (PENDING_STATUSES.includes(record.status)) {
                            const colorClass =
                              record.status === "PARTIALLY_DAMAGED"
                                ? "border-red-400 bg-red-50 text-red-700"
                                : record.status === "PARTIALLY_LOST"
                                ? "border-orange-400 bg-orange-50 text-orange-700"
                                : record.status === "PARTIALLY_RETURNED"
                                ? "border-blue-400 bg-blue-50 text-blue-700"
                                : "border-yellow-400 bg-yellow-100 text-yellow-800";
                            const label =
                              record.status === "PENDING" ? "PENDING"
                              : record.status === "PARTIALLY_RETURNED" ? "PARTIALLY RETURNED"
                              : record.status === "PARTIALLY_DAMAGED" ? "PARTIALLY DAMAGED"
                              : "PARTIALLY LOST";
                            return (
                              <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded border ${colorClass}`}>
                                {label}
                              </span>
                            );
                          }

                          const returnedCount = FINAL_RETURNED.includes(record.status)
                            ? Math.max(0, orig - d - l)
                            : 0;
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

                          const fallbackColor =
                            record.status === "CONSUMABLE" ? "bg-purple-100 text-purple-800"
                            : "bg-gray-100 text-gray-700";
                          return (
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${fallbackColor}`}>
                              {record.status || "—"}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">{record.mobile || "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
