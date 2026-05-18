"use client";

import { useEffect, useState } from "react";
import { useUser } from "@/contexts/UserContext";
import { authFetch } from "@/contexts/UserContext";
import { useRouter } from "next/navigation";
import { Plus, Pencil, UserCheck, UserX, Shield, User, Building2, Trash2 } from "lucide-react";

type AppUser = {
  user_id: string;
  email: string;
  full_name: string;
  role: "super_admin" | "user";
  is_active: boolean;
  created_at: string;
};

type AddUserForm = {
  full_name: string;
  email: string;
  password: string;
  role: "user" | "super_admin";
};

type Department = {
  department_id: string;
  department_name: string;
};

export default function UserManagementPage() {
  const { appUser, loading } = useUser();
  const router = useRouter();

  const [users, setUsers] = useState<AppUser[]>([]);
  const [fetching, setFetching] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [form, setForm] = useState<AddUserForm>({ full_name: "", email: "", password: "", role: "user" });
  const [editForm, setEditForm] = useState<Partial<{ full_name: string; role: string; is_active: boolean }>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptFetching, setDeptFetching] = useState(true);
  const [deptSavingId, setDeptSavingId] = useState<string | null>(null);
  const [deptDeletingId, setDeptDeletingId] = useState<string | null>(null);
  const [deptEditId, setDeptEditId] = useState<string | null>(null);
  const [deptEditValue, setDeptEditValue] = useState("");
  const [addingDept, setAddingDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [deptError, setDeptError] = useState("");

  useEffect(() => {
    if (!loading && appUser?.role !== "super_admin") {
      router.replace("/dashboard");
    }
  }, [appUser, loading, router]);

  useEffect(() => {
    if (appUser?.role === "super_admin") {
      loadUsers();
      loadDepartments();
    }
  }, [appUser]);

  async function loadUsers() {
    setFetching(true);
    try {
      const res = await authFetch("/api/admin/users");
      const data = await res.json();
      setUsers(data || []);
    } catch {
      setError("Failed to load users");
    } finally {
      setFetching(false);
    }
  }

  async function loadDepartments() {
    setDeptFetching(true);
    setDeptError("");
    try {
      const res = await authFetch("/api/departments");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load departments");
      const rows: Department[] = Array.isArray(data) ? data : [];
      setDepartments(rows);
    } catch (err: any) {
      setDeptError(err.message || "Failed to load departments");
    } finally {
      setDeptFetching(false);
    }
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await authFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create user");
      setShowAdd(false);
      setForm({ full_name: "", email: "", password: "", role: "user" });
      await loadUsers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleEditUser(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    setSaving(true);
    setError("");
    try {
      const res = await authFetch(`/api/admin/users/${editUser.user_id}`, {
        method: "PUT",
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update user");
      setEditUser(null);
      await loadUsers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleStartEditDepartment(dept: Department) {
    setDeptEditId(dept.department_id);
    setDeptEditValue(dept.department_name);
    setDeptError("");
  }

  function handleCancelEditDepartment() {
    setDeptEditId(null);
    setDeptEditValue("");
  }

  async function handleUpdateDepartment() {
    if (!deptEditId) return;

    const department_name = deptEditValue.trim();
    if (!department_name) {
      setDeptError("Department name cannot be empty");
      return;
    }

    setDeptSavingId(deptEditId);
    setDeptError("");
    try {
      const res = await authFetch(`/api/departments/${deptEditId}`, {
        method: "PUT",
        body: JSON.stringify({ department_name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update department");
      handleCancelEditDepartment();
      await loadDepartments();
    } catch (err: any) {
      setDeptError(err.message || "Failed to update department");
    } finally {
      setDeptSavingId(null);
    }
  }

  async function handleDeleteDepartment(dept: Department) {
    const confirmed = window.confirm(`Delete department \"${dept.department_name}\"?`);
    if (!confirmed) return;

    setDeptDeletingId(dept.department_id);
    setDeptError("");
    try {
      const res = await authFetch(`/api/departments/${dept.department_id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete department");

      if (deptEditId === dept.department_id) {
        handleCancelEditDepartment();
      }
      await loadDepartments();
    } catch (err: any) {
      setDeptError(err.message || "Failed to delete department");
    } finally {
      setDeptDeletingId(null);
    }
  }

  async function handleAddDepartment() {
    const department_name = newDeptName.trim();
    if (!department_name) {
      setDeptError("Department name cannot be empty");
      return;
    }

    setAddingDept(true);
    setDeptError("");
    try {
      const res = await authFetch("/api/departments", {
        method: "POST",
        body: JSON.stringify({ department_name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add department");
      setNewDeptName("");
      await loadDepartments();
    } catch (err: any) {
      setDeptError(err.message || "Failed to add department");
    } finally {
      setAddingDept(false);
    }
  }

  function openEdit(u: AppUser) {
    setEditUser(u);
    setEditForm({ full_name: u.full_name, role: u.role, is_active: u.is_active });
    setError("");
  }

  if (loading || !appUser) return null;
  if (appUser.role !== "super_admin") return null;

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    color: "var(--text)",
    fontSize: 13,
    outline: "none",
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
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", margin: 0 }}>Admin Settings</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>
            Manage system users and department settings
          </p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setError(""); }}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 16px", background: "#1E2938", color: "#fff",
            border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          <Plus size={15} /> Add User
        </button>
      </div>

      {/* Stats strip */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total Users", value: users.length },
          { label: "Active", value: users.filter(u => u.is_active).length },
          { label: "Admins", value: users.filter(u => u.role === "super_admin").length },
        ].map(s => (
          <div key={s.label} style={{ flex: 1, background: "var(--bg)", borderRadius: 10, padding: "14px 18px", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{s.value}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Users table */}
      <div style={{ background: "var(--bg)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        {fetching ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Loading...</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["Name", "Email", "Role", "Status", "Joined", "Actions"].map(h => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={u.user_id} style={{ borderBottom: i < users.length - 1 ? "1px solid var(--border)" : "none", transition: "background 0.1s" }}>
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: "50%", background: "#1E2938",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0,
                      }}>
                        {u.full_name.charAt(0).toUpperCase()}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{u.full_name}</span>
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--muted)" }}>{u.email}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                      background: u.role === "super_admin" ? "rgba(99,102,241,0.12)" : "rgba(100,116,139,0.12)",
                      color: u.role === "super_admin" ? "#6366f1" : "var(--muted)",
                    }}>
                      {u.role === "super_admin" ? <Shield size={10} /> : <User size={10} />}
                      {u.role === "super_admin" ? "Admin" : "User"}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                      background: u.is_active ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                      color: u.is_active ? "#16a34a" : "#dc2626",
                    }}>
                      {u.is_active ? <UserCheck size={10} /> : <UserX size={10} />}
                      {u.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--muted)" }}>
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <button
                      onClick={() => openEdit(u)}
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

      {/* Add User Modal */}
      {showAdd && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 50,
        }}>
          <div style={{ background: "var(--bg)", borderRadius: 14, padding: 28, width: 420, border: "1px solid var(--border)" }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: "0 0 20px" }}>Add New User</h2>
            {error && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "8px 12px", fontSize: 13, color: "#dc2626", marginBottom: 16 }}>{error}</div>}
            <form onSubmit={handleAddUser} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={labelStyle}>Full Name</label>
                <input style={inputStyle} value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} required placeholder="Enter full name" />
              </div>
              <div>
                <label style={labelStyle}>Email Address</label>
                <input style={inputStyle} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required placeholder="user@example.com" />
              </div>
              <div>
                <label style={labelStyle}>Temporary Password</label>
                <input style={inputStyle} type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required placeholder="Min. 6 characters" minLength={6} />
              </div>
              <div>
                <label style={labelStyle}>Role</label>
                <select style={inputStyle} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as any }))}>
                  <option value="user">User</option>
                  <option value="super_admin">System Administrator</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                <button type="button" onClick={() => setShowAdd(false)} style={{ flex: 1, padding: "9px 16px", background: "transparent", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, fontWeight: 500, color: "var(--text)", cursor: "pointer" }}>
                  Cancel
                </button>
                <button type="submit" disabled={saving} style={{ flex: 1, padding: "9px 16px", background: "#1E2938", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
                  {saving ? "Creating..." : "Create User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Department settings */}
      <div style={{ marginTop: 24, background: "var(--bg)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Building2 size={16} color="var(--muted)" />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Departments</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>View and update department names used across the system</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
              {departments.length} total
            </div>
          </div>

          <div style={{ padding: 16, borderBottom: "1px solid var(--border)", display: "flex", gap: 8 }}>
            <input
              style={{ ...inputStyle, margin: 0 }}
              value={newDeptName}
              onChange={(e) => setNewDeptName(e.target.value)}
              placeholder="Add a new department"
            />
            <button
              type="button"
              onClick={handleAddDepartment}
              disabled={addingDept}
              style={{
                padding: "8px 14px",
                background: "#1E2938",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: addingDept ? "not-allowed" : "pointer",
                opacity: addingDept ? 0.7 : 1,
                whiteSpace: "nowrap",
              }}
            >
              {addingDept ? "Adding..." : "Add Department"}
            </button>
          </div>

          {deptError && (
            <div style={{ margin: 16, marginBottom: 0, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "8px 12px", fontSize: 13, color: "#dc2626" }}>
              {deptError}
            </div>
          )}

          {deptFetching ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Loading departments...</div>
          ) : departments.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No departments found.</div>
          ) : (
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              {departments.map((dept) => {
                const isSaving = deptSavingId === dept.department_id;
                const isDeleting = deptDeletingId === dept.department_id;
                const isEditing = deptEditId === dept.department_id;
                const changed = deptEditValue.trim() !== dept.department_name;

                return (
                  <div key={dept.department_id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
                    {isEditing ? (
                      <input
                        style={{ ...inputStyle, margin: 0 }}
                        value={deptEditValue}
                        onChange={(e) => setDeptEditValue(e.target.value)}
                      />
                    ) : (
                      <div style={{ ...inputStyle, margin: 0, display: "flex", alignItems: "center", minHeight: 38 }}>
                        {dept.department_name}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={handleUpdateDepartment}
                            disabled={isSaving || !changed || deptEditValue.trim() === ""}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: "1px solid var(--border)",
                              background: "#1E2938",
                              color: "#fff",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: isSaving || !changed || deptEditValue.trim() === "" ? "not-allowed" : "pointer",
                              opacity: isSaving || !changed || deptEditValue.trim() === "" ? 0.7 : 1,
                            }}
                          >
                            {isSaving ? "Saving..." : "Update"}
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelEditDepartment}
                            disabled={isSaving}
                            style={{
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: "1px solid var(--border)",
                              background: "transparent",
                              color: "var(--text)",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: isSaving ? "not-allowed" : "pointer",
                              opacity: isSaving ? 0.7 : 1,
                            }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleStartEditDepartment(dept)}
                            disabled={!!deptEditId || isDeleting}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: "1px solid var(--border)",
                              background: "transparent",
                              color: "var(--text)",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: !!deptEditId || isDeleting ? "not-allowed" : "pointer",
                              opacity: !!deptEditId || isDeleting ? 0.7 : 1,
                            }}
                          >
                            <Pencil size={12} />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDepartment(dept)}
                            disabled={!!deptEditId || isDeleting}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: "1px solid rgba(220,38,38,0.35)",
                              background: "rgba(220,38,38,0.08)",
                              color: "#dc2626",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: !!deptEditId || isDeleting ? "not-allowed" : "pointer",
                              opacity: !!deptEditId || isDeleting ? 0.7 : 1,
                            }}
                          >
                            <Trash2 size={12} />
                            {isDeleting ? "Deleting..." : "Delete"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {/* Edit User Modal */}
      {editUser && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 50,
        }}>
          <div style={{ background: "var(--bg)", borderRadius: 14, padding: 28, width: 420, border: "1px solid var(--border)" }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: "0 0 20px" }}>Edit User</h2>
            {error && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "8px 12px", fontSize: 13, color: "#dc2626", marginBottom: 16 }}>{error}</div>}
            <form onSubmit={handleEditUser} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={labelStyle}>Full Name</label>
                <input style={inputStyle} value={editForm.full_name || ""} onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))} required />
              </div>
              <div>
                <label style={labelStyle}>Email (read-only)</label>
                <input style={{ ...inputStyle, opacity: 0.6 }} value={editUser.email} disabled />
              </div>
              <div>
                <label style={labelStyle}>Role</label>
                <select style={inputStyle} value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="user">User</option>
                  <option value="super_admin">System Administrator</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Status</label>
                <select style={inputStyle} value={editForm.is_active ? "active" : "inactive"} onChange={e => setEditForm(f => ({ ...f, is_active: e.target.value === "active" }))}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                <button type="button" onClick={() => setEditUser(null)} style={{ flex: 1, padding: "9px 16px", background: "transparent", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, fontWeight: 500, color: "var(--text)", cursor: "pointer" }}>
                  Cancel
                </button>
                <button type="submit" disabled={saving} style={{ flex: 1, padding: "9px 16px", background: "#1E2938", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
