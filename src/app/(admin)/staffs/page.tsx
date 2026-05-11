"use client";

import { useEffect, useState, useCallback } from "react";
import { authFetch } from "@/contexts/UserContext";
import { Plus, Pencil, Search, UserPen } from "lucide-react";

type Department = { department_id: string; department_name: string };

type Staff = {
  staff_id: string;
  staff_name: string;
  employee_id: string | null;
  email: string | null;
  phone_number: string | null;
  department_id: string | null;
  departments: { department_name: string } | null;
};

type StaffForm = {
  staff_name: string;
  employee_id: string;
  email: string;
  phone_number: string;
  department_id: string;
};

const EMPTY_FORM: StaffForm = {
  staff_name: "",
  employee_id: "",
  email: "",
  phone_number: "",
  department_id: "",
};

export default function StaffsPage() {
  const [staffs, setStaffs] = useState<Staff[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [search, setSearch] = useState("");
  const [fetching, setFetching] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editStaff, setEditStaff] = useState<Staff | null>(null);
  const [form, setForm] = useState<StaffForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadStaffs = useCallback(async (q?: string) => {
    setFetching(true);
    try {
      const url = q ? `/api/staffs?search=${encodeURIComponent(q)}` : "/api/staffs";
      const res = await authFetch(url);
      const data = await res.json();
      setStaffs(data || []);
    } catch {
      setError("Failed to load staff");
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    loadStaffs();
    authFetch("/api/departments").then(r => r.json()).then(d => setDepartments(d || []));
  }, [loadStaffs]);

  useEffect(() => {
    const t = setTimeout(() => loadStaffs(search || undefined), 300);
    return () => clearTimeout(t);
  }, [search, loadStaffs]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await authFetch("/api/staffs", {
        method: "POST",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create staff");
      setShowAdd(false);
      setForm(EMPTY_FORM);
      await loadStaffs(search || undefined);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editStaff) return;
    setSaving(true);
    setError("");
    try {
      const res = await authFetch(`/api/staffs/${editStaff.staff_id}`, {
        method: "PUT",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update staff");
      setEditStaff(null);
      await loadStaffs(search || undefined);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function openEdit(s: Staff) {
    setEditStaff(s);
    setForm({
      staff_name: s.staff_name,
      employee_id: s.employee_id || "",
      email: s.email || "",
      phone_number: s.phone_number || "",
      department_id: s.department_id || "",
    });
    setError("");
  }

  function openAdd() {
    setForm(EMPTY_FORM);
    setError("");
    setShowAdd(true);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    color: "var(--text)",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    color: "var(--muted)",
    fontWeight: 500,
    marginBottom: 4,
    display: "block",
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", margin: 0 }}>Staff Management</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>
            Manage staff records and department assignments
          </p>
        </div>
        <button
          onClick={openAdd}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 16px", background: "#1E2938", color: "#fff",
            border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          <Plus size={15} /> Add Staff
        </button>
      </div>

      {/* Stats strip */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total Staff", value: staffs.length },
          { label: "With Email", value: staffs.filter(s => s.email).length },
          { label: "Departments", value: new Set(staffs.map(s => s.department_id).filter(Boolean)).size },
        ].map(s => (
          <div key={s.label} style={{ flex: 1, background: "var(--bg)", borderRadius: 10, padding: "14px 18px", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{s.value}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: 16, maxWidth: 360 }}>
        <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, ID, or email..."
          style={{ ...inputStyle, paddingLeft: 32 }}
        />
      </div>

      {/* Table */}
      <div style={{ background: "var(--bg)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        {fetching ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Loading...</div>
        ) : staffs.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <UserPen size={36} style={{ color: "var(--muted)", marginBottom: 12 }} />
            <p style={{ fontSize: 14, color: "var(--muted)", margin: 0 }}>No staff found</p>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["Name", "Employee ID", "Department", "Email", "Phone", "Actions"].map(h => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staffs.map((s, i) => (
                <tr key={s.staff_id} style={{ borderBottom: i < staffs.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: "50%", background: "#1E2938",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0,
                      }}>
                        {(s.staff_name || "?").charAt(0).toUpperCase()}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{s.staff_name || "—"}</span>
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--muted)" }}>{s.employee_id || "—"}</td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--muted)" }}>
                    {s.departments?.department_name || "—"}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--muted)" }}>{s.email || "—"}</td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--muted)" }}>{s.phone_number || "—"}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <button
                      onClick={() => openEdit(s)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        padding: "5px 12px", background: "transparent", border: "1px solid var(--border)",
                        borderRadius: 6, fontSize: 12, fontWeight: 500, color: "var(--text)", cursor: "pointer",
                      }}
                    >
                      <Pencil size={12} /> Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Modal */}
      {showAdd && (
        <Modal title="Add New Staff" onClose={() => setShowAdd(false)}>
          {error && <ErrorBox msg={error} />}
          <form onSubmit={handleAdd} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Full Name" labelStyle={labelStyle}>
              <input style={inputStyle} value={form.staff_name} onChange={e => setForm(f => ({ ...f, staff_name: e.target.value }))} required placeholder="Enter full name" />
            </Field>
            <Field label="Employee ID" labelStyle={labelStyle}>
              <input style={inputStyle} value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} placeholder="e.g. EMP001" />
            </Field>
            <Field label="Department" labelStyle={labelStyle}>
              <select style={inputStyle} value={form.department_id} onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}>
                <option value="">— Select Department —</option>
                {departments.map(d => <option key={d.department_id} value={d.department_id}>{d.department_name}</option>)}
              </select>
            </Field>
            <Field label="Email" labelStyle={labelStyle}>
              <input style={inputStyle} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="staff@example.com" />
            </Field>
            <Field label="Phone Number" labelStyle={labelStyle}>
              <input style={inputStyle} value={form.phone_number} onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))} placeholder="+91 98765 43210" />
            </Field>
            <ModalActions onCancel={() => setShowAdd(false)} saving={saving} submitLabel="Add Staff" />
          </form>
        </Modal>
      )}

      {/* Edit Modal */}
      {editStaff && (
        <Modal title="Edit Staff" onClose={() => setEditStaff(null)}>
          {error && <ErrorBox msg={error} />}
          <form onSubmit={handleEdit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Full Name" labelStyle={labelStyle}>
              <input style={inputStyle} value={form.staff_name} onChange={e => setForm(f => ({ ...f, staff_name: e.target.value }))} required />
            </Field>
            <Field label="Employee ID" labelStyle={labelStyle}>
              <input style={inputStyle} value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} />
            </Field>
            <Field label="Department" labelStyle={labelStyle}>
              <select style={inputStyle} value={form.department_id} onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}>
                <option value="">— Select Department —</option>
                {departments.map(d => <option key={d.department_id} value={d.department_id}>{d.department_name}</option>)}
              </select>
            </Field>
            <Field label="Email" labelStyle={labelStyle}>
              <input style={inputStyle} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </Field>
            <Field label="Phone Number" labelStyle={labelStyle}>
              <input style={inputStyle} value={form.phone_number} onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))} />
            </Field>
            <ModalActions onCancel={() => setEditStaff(null)} saving={saving} submitLabel="Save Changes" />
          </form>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "var(--bg)", borderRadius: 14, padding: 28, width: 440, border: "1px solid var(--border)", maxHeight: "90vh", overflowY: "auto" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: "0 0 20px" }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Field({ label, labelStyle, children }: { label: string; labelStyle: React.CSSProperties; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "8px 12px", fontSize: 13, color: "#dc2626", marginBottom: 16 }}>
      {msg}
    </div>
  );
}

function ModalActions({ onCancel, saving, submitLabel }: { onCancel: () => void; saving: boolean; submitLabel: string }) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
      <button type="button" onClick={onCancel} style={{ flex: 1, padding: "9px 16px", background: "transparent", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, fontWeight: 500, color: "var(--text)", cursor: "pointer" }}>
        Cancel
      </button>
      <button type="submit" disabled={saving} style={{ flex: 1, padding: "9px 16px", background: "#1E2938", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
        {saving ? "Saving..." : submitLabel}
      </button>
    </div>
  );
}
