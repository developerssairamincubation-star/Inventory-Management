"use client";

import { useEffect, useState } from "react";
import { useUser } from "@/contexts/UserContext";
import { authFetch } from "@/contexts/UserContext";
import { extractErrorMessage } from "@/lib/extractErrorMessage";
import { useRouter } from "next/navigation";
import { Plus, Pencil, UserCheck, UserX, Shield, User, Building2, Trash2, MapPin, Tag } from "lucide-react";

type AppUser = {
  user_id: string;
  email: string;
  full_name: string;
  role: "super_admin" | "user";
  is_active: boolean;
  domain_id: string | null;
  created_at: string;
};

type AddUserForm = {
  full_name: string;
  email: string;
  password: string;
  role: "user" | "super_admin";
  domain_id: string;
};

type Department = {
  department_id: string;
  department_name: string;
  code: string | null;
};

type CoeDomain = {
  domain_id: string;
  domain_name: string;
  room_name: string;
};

type Category = {
  category_id: string;
  category_name: string;
  code: string | null;
};

export default function UserManagementPage() {
  const { appUser, loading } = useUser();
  const router = useRouter();

  const [users, setUsers] = useState<AppUser[]>([]);
  const [fetching, setFetching] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [form, setForm] = useState<AddUserForm>({ full_name: "", email: "", password: "", role: "user", domain_id: "" });
  const [editForm, setEditForm] = useState<Partial<{ full_name: string; role: string; is_active: boolean; domain_id: string }>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptFetching, setDeptFetching] = useState(true);
  const [deptSavingId, setDeptSavingId] = useState<string | null>(null);
  const [deptDeletingId, setDeptDeletingId] = useState<string | null>(null);
  const [deptEditId, setDeptEditId] = useState<string | null>(null);
  const [deptEditValue, setDeptEditValue] = useState("");
  const [deptEditCode, setDeptEditCode] = useState("");
  const [addingDept, setAddingDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [newDeptCode, setNewDeptCode] = useState("");
  const [deptError, setDeptError] = useState("");

  const [domains, setDomains] = useState<CoeDomain[]>([]);
  const [domainFetching, setDomainFetching] = useState(true);
  const [domainSavingId, setDomainSavingId] = useState<string | null>(null);
  const [domainDeletingId, setDomainDeletingId] = useState<string | null>(null);
  const [domainEditId, setDomainEditId] = useState<string | null>(null);
  const [domainEditName, setDomainEditName] = useState("");
  const [domainEditRoom, setDomainEditRoom] = useState("");
  const [addingDomain, setAddingDomain] = useState(false);
  const [newDomainName, setNewDomainName] = useState("");
  const [newRoomName, setNewRoomName] = useState("");
  const [domainError, setDomainError] = useState("");

  const [categoriesList, setCategoriesList] = useState<Category[]>([]);
  const [catFetching, setCatFetching] = useState(true);
  const [catSavingId, setCatSavingId] = useState<string | null>(null);
  const [catEditId, setCatEditId] = useState<string | null>(null);
  const [catEditName, setCatEditName] = useState("");
  const [catEditCode, setCatEditCode] = useState("");
  const [catError, setCatError] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryCode, setNewCategoryCode] = useState("");

  useEffect(() => {
    if (!loading && appUser?.role !== "super_admin") {
      router.replace("/dashboard");
    }
  }, [appUser, loading, router]);

  useEffect(() => {
    if (appUser?.role === "super_admin") {
      loadUsers();
      loadDepartments();
      loadDomains();
      loadCategories();
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
      if (!res.ok) throw new Error(extractErrorMessage(data, "Failed to load departments"));
      const rows: Department[] = Array.isArray(data) ? data : [];
      setDepartments(rows);
    } catch (err: any) {
      setDeptError(err.message || "Failed to load departments");
    } finally {
      setDeptFetching(false);
    }
  }

  async function loadDomains() {
    setDomainFetching(true);
    setDomainError("");
    try {
      const res = await authFetch("/api/coe-domains");
      const data = await res.json();
      if (!res.ok) throw new Error(extractErrorMessage(data, "Failed to load COE domains"));
      setDomains(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setDomainError(err.message || "Failed to load COE domains");
    } finally {
      setDomainFetching(false);
    }
  }

  async function loadCategories() {
    setCatFetching(true);
    setCatError("");
    try {
      const res = await authFetch("/api/categories");
      const data = await res.json();
      if (!res.ok) throw new Error(extractErrorMessage(data, "Failed to load categories"));
      setCategoriesList(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setCatError(err.message || "Failed to load categories");
    } finally {
      setCatFetching(false);
    }
  }

  function handleStartEditCategory(cat: Category) {
    setCatEditId(cat.category_id);
    setCatEditName(cat.category_name);
    setCatEditCode(cat.code || "");
    setCatError("");
  }

  function handleCancelEditCategory() {
    setCatEditId(null);
    setCatEditName("");
    setCatEditCode("");
  }

  async function handleUpdateCategory() {
    if (!catEditId) return;
    const category_name = catEditName.trim();
    if (!category_name) {
      setCatError("Category name cannot be empty");
      return;
    }

    setCatSavingId(catEditId);
    setCatError("");
    try {
      const res = await authFetch(`/api/categories/${catEditId}`, {
        method: "PUT",
        body: JSON.stringify({ category_name, code: catEditCode.trim().toUpperCase() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(extractErrorMessage(data, "Failed to update category"));
      handleCancelEditCategory();
      await loadCategories();
    } catch (err: any) {
      setCatError(err.message || "Failed to update category");
    } finally {
      setCatSavingId(null);
    }
  }

  async function handleAddCategory() {
    const category_name = newCategoryName.trim();
    if (!category_name) {
      setCatError("Category name cannot be empty");
      return;
    }

    setAddingCategory(true);
    setCatError("");
    try {
      const res = await authFetch("/api/categories", {
        method: "POST",
        body: JSON.stringify({ category_name, code: newCategoryCode.trim().toUpperCase() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(extractErrorMessage(data, "Failed to add category"));
      setNewCategoryName("");
      setNewCategoryCode("");
      await loadCategories();
    } catch (err: any) {
      setCatError(err.message || "Failed to add category");
    } finally {
      setAddingCategory(false);
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
      if (!res.ok) throw new Error(extractErrorMessage(data, "Failed to create user"));
      setShowAdd(false);
      setForm({ full_name: "", email: "", password: "", role: "user", domain_id: "" });
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
      if (!res.ok) throw new Error(extractErrorMessage(data, "Failed to update user"));
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
    setDeptEditCode(dept.code || "");
    setDeptError("");
  }

  function handleCancelEditDepartment() {
    setDeptEditId(null);
    setDeptEditValue("");
    setDeptEditCode("");
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
        body: JSON.stringify({ department_name, code: deptEditCode.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(extractErrorMessage(data, "Failed to update department"));
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
      if (!res.ok) throw new Error(extractErrorMessage(data, "Failed to delete department"));

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
        body: JSON.stringify({ department_name, code: newDeptCode.trim().toUpperCase() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(extractErrorMessage(data, "Failed to add department"));
      setNewDeptName("");
      setNewDeptCode("");
      await loadDepartments();
    } catch (err: any) {
      setDeptError(err.message || "Failed to add department");
    } finally {
      setAddingDept(false);
    }
  }

  function handleStartEditDomain(domain: CoeDomain) {
    setDomainEditId(domain.domain_id);
    setDomainEditName(domain.domain_name);
    setDomainEditRoom(domain.room_name);
    setDomainError("");
  }

  function handleCancelEditDomain() {
    setDomainEditId(null);
    setDomainEditName("");
    setDomainEditRoom("");
  }

  async function handleUpdateDomain() {
    if (!domainEditId) return;

    const domain_name = domainEditName.trim();
    const room_name = domainEditRoom.trim();
    if (!domain_name || !room_name) {
      setDomainError("Domain name and room are both required");
      return;
    }

    setDomainSavingId(domainEditId);
    setDomainError("");
    try {
      const res = await authFetch(`/api/coe-domains/${domainEditId}`, {
        method: "PUT",
        body: JSON.stringify({ domain_name, room_name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(extractErrorMessage(data, "Failed to update COE domain"));
      handleCancelEditDomain();
      await loadDomains();
    } catch (err: any) {
      setDomainError(err.message || "Failed to update COE domain");
    } finally {
      setDomainSavingId(null);
    }
  }

  async function handleDeleteDomain(domain: CoeDomain) {
    const confirmed = window.confirm(`Delete COE domain \"${domain.domain_name}\"?`);
    if (!confirmed) return;

    setDomainDeletingId(domain.domain_id);
    setDomainError("");
    try {
      const res = await authFetch(`/api/coe-domains/${domain.domain_id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(extractErrorMessage(data, "Failed to delete COE domain"));

      if (domainEditId === domain.domain_id) {
        handleCancelEditDomain();
      }
      await loadDomains();
    } catch (err: any) {
      setDomainError(err.message || "Failed to delete COE domain");
    } finally {
      setDomainDeletingId(null);
    }
  }

  async function handleAddDomain() {
    const domain_name = newDomainName.trim();
    const room_name = newRoomName.trim();
    if (!domain_name || !room_name) {
      setDomainError("Domain name and room are both required");
      return;
    }

    setAddingDomain(true);
    setDomainError("");
    try {
      const res = await authFetch("/api/coe-domains", {
        method: "POST",
        body: JSON.stringify({ domain_name, room_name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(extractErrorMessage(data, "Failed to add COE domain"));
      setNewDomainName("");
      setNewRoomName("");
      await loadDomains();
    } catch (err: any) {
      setDomainError(err.message || "Failed to add COE domain");
    } finally {
      setAddingDomain(false);
    }
  }

  function openEdit(u: AppUser) {
    setEditUser(u);
    setEditForm({ full_name: u.full_name, role: u.role, is_active: u.is_active, domain_id: u.domain_id || "" });
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

  // Compact table cells shared by the Departments / COE Domains / Categories
  // sections — each section body scrolls internally (see sectionListWrap)
  // instead of growing the page, no matter how many rows it has.
  const sectionTh: React.CSSProperties = {
    position: "sticky",
    top: 0,
    padding: "8px 16px",
    textAlign: "left",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    background: "var(--bg)",
    zIndex: 1,
  };
  const sectionTd: React.CSSProperties = {
    padding: "7px 16px",
    fontSize: 13,
    color: "var(--text)",
  };
  const sectionListWrap: React.CSSProperties = {
    maxHeight: 320,
    overflowY: "auto",
  };
  const sectionCellInput: React.CSSProperties = {
    ...inputStyle,
    padding: "5px 8px",
    margin: 0,
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
                <select style={inputStyle} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as any, domain_id: e.target.value === "super_admin" ? "" : f.domain_id }))}>
                  <option value="user">User</option>
                  <option value="super_admin">System Administrator</option>
                </select>
              </div>
              {form.role === "user" && (
                <div>
                  <label style={labelStyle}>COE Domain</label>
                  <select style={inputStyle} value={form.domain_id} onChange={e => setForm(f => ({ ...f, domain_id: e.target.value }))} required>
                    <option value="">Select a COE domain...</option>
                    {domains.map(d => <option key={d.domain_id} value={d.domain_id}>{d.domain_name} ({d.room_name})</option>)}
                  </select>
                </div>
              )}
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

      {/* Departments / COE Domains / Categories — bento grid so these three
          cards sit side by side instead of stacking the page ever longer. */}
      <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
      {/* Department settings */}
      <div style={{ background: "var(--bg)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
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
            <input
              style={{ ...inputStyle, margin: 0, width: 70, textAlign: "center", textTransform: "uppercase" }}
              value={newDeptCode}
              onChange={(e) => setNewDeptCode(e.target.value.slice(0, 2))}
              placeholder="Code"
              maxLength={2}
              title="2-letter code used by the student-ID decoder"
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
            <div style={sectionListWrap}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={sectionTh}>Department</th>
                    <th style={{ ...sectionTh, width: 90 }}>Code</th>
                    <th style={{ ...sectionTh, width: 170 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {departments.map((dept, i) => {
                    const isSaving = deptSavingId === dept.department_id;
                    const isDeleting = deptDeletingId === dept.department_id;
                    const isEditing = deptEditId === dept.department_id;
                    const changed = isEditing && (deptEditValue.trim() !== dept.department_name || deptEditCode.trim().toUpperCase() !== (dept.code || ""));

                    return (
                      <tr key={dept.department_id} style={{ borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                        <td style={sectionTd}>
                          {isEditing ? (
                            <input
                              style={sectionCellInput}
                              value={deptEditValue}
                              onChange={(e) => setDeptEditValue(e.target.value)}
                              autoFocus
                            />
                          ) : (
                            dept.department_name
                          )}
                        </td>
                        <td style={sectionTd}>
                          {isEditing ? (
                            <input
                              style={{ ...sectionCellInput, textAlign: "center", textTransform: "uppercase" }}
                              value={deptEditCode}
                              onChange={(e) => setDeptEditCode(e.target.value.slice(0, 2))}
                              maxLength={2}
                            />
                          ) : (
                            <span style={{ color: "var(--muted)", fontWeight: 600 }}>{dept.code || "—"}</span>
                          )}
                        </td>
                        <td style={sectionTd}>
                          <div style={{ display: "flex", gap: 6 }}>
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={handleUpdateDepartment}
                                  disabled={isSaving || !changed || deptEditValue.trim() === ""}
                                  style={{
                                    padding: "5px 10px",
                                    borderRadius: 6,
                                    border: "1px solid var(--border)",
                                    background: "#1E2938",
                                    color: "#fff",
                                    fontSize: 11,
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
                                    padding: "5px 10px",
                                    borderRadius: 6,
                                    border: "1px solid var(--border)",
                                    background: "transparent",
                                    color: "var(--text)",
                                    fontSize: 11,
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
                                    gap: 4,
                                    padding: "5px 10px",
                                    borderRadius: 6,
                                    border: "1px solid var(--border)",
                                    background: "transparent",
                                    color: "var(--text)",
                                    fontSize: 11,
                                    fontWeight: 600,
                                    cursor: !!deptEditId || isDeleting ? "not-allowed" : "pointer",
                                    opacity: !!deptEditId || isDeleting ? 0.7 : 1,
                                  }}
                                >
                                  <Pencil size={11} />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteDepartment(dept)}
                                  disabled={!!deptEditId || isDeleting}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    padding: "5px 10px",
                                    borderRadius: 6,
                                    border: "1px solid rgba(220,38,38,0.35)",
                                    background: "rgba(220,38,38,0.08)",
                                    color: "#dc2626",
                                    fontSize: 11,
                                    fontWeight: 600,
                                    cursor: !!deptEditId || isDeleting ? "not-allowed" : "pointer",
                                    opacity: !!deptEditId || isDeleting ? 0.7 : 1,
                                  }}
                                >
                                  <Trash2 size={11} />
                                  {isDeleting ? "Deleting..." : "Delete"}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {/* COE Domains */}
      <div style={{ background: "var(--bg)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <MapPin size={16} color="var(--muted)" />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>COE Domains</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Each domain (Center of Excellence) has one room; COE users are assigned to a domain and their lending entries auto-fill it</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
              {domains.length} total
            </div>
          </div>

          <div style={{ padding: 16, borderBottom: "1px solid var(--border)", display: "flex", gap: 8 }}>
            <input
              style={{ ...inputStyle, margin: 0 }}
              value={newDomainName}
              onChange={(e) => setNewDomainName(e.target.value)}
              placeholder="Domain name (e.g. AI & Robotics)"
            />
            <input
              style={{ ...inputStyle, margin: 0 }}
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              placeholder="Room (e.g. Lab 204)"
            />
            <button
              type="button"
              onClick={handleAddDomain}
              disabled={addingDomain}
              style={{
                padding: "8px 14px",
                background: "#1E2938",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: addingDomain ? "not-allowed" : "pointer",
                opacity: addingDomain ? 0.7 : 1,
                whiteSpace: "nowrap",
              }}
            >
              {addingDomain ? "Adding..." : "Add Domain"}
            </button>
          </div>

          {domainError && (
            <div style={{ margin: 16, marginBottom: 0, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "8px 12px", fontSize: 13, color: "#dc2626" }}>
              {domainError}
            </div>
          )}

          {domainFetching ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Loading COE domains...</div>
          ) : domains.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No COE domains found.</div>
          ) : (
            <div style={sectionListWrap}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={sectionTh}>Domain</th>
                    <th style={sectionTh}>Room</th>
                    <th style={{ ...sectionTh, width: 170 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {domains.map((domain, i) => {
                    const isSaving = domainSavingId === domain.domain_id;
                    const isDeleting = domainDeletingId === domain.domain_id;
                    const isEditing = domainEditId === domain.domain_id;
                    const changed = isEditing && (domainEditName.trim() !== domain.domain_name || domainEditRoom.trim() !== domain.room_name);

                    return (
                      <tr key={domain.domain_id} style={{ borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                        <td style={sectionTd}>
                          {isEditing ? (
                            <input
                              style={sectionCellInput}
                              value={domainEditName}
                              onChange={(e) => setDomainEditName(e.target.value)}
                              autoFocus
                            />
                          ) : (
                            domain.domain_name
                          )}
                        </td>
                        <td style={sectionTd}>
                          {isEditing ? (
                            <input
                              style={sectionCellInput}
                              value={domainEditRoom}
                              onChange={(e) => setDomainEditRoom(e.target.value)}
                            />
                          ) : (
                            <span style={{ color: "var(--muted)" }}>{domain.room_name}</span>
                          )}
                        </td>
                        <td style={sectionTd}>
                          <div style={{ display: "flex", gap: 6 }}>
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={handleUpdateDomain}
                                  disabled={isSaving || !changed}
                                  style={{
                                    padding: "5px 10px",
                                    borderRadius: 6,
                                    border: "1px solid var(--border)",
                                    background: "#1E2938",
                                    color: "#fff",
                                    fontSize: 11,
                                    fontWeight: 600,
                                    cursor: isSaving || !changed ? "not-allowed" : "pointer",
                                    opacity: isSaving || !changed ? 0.7 : 1,
                                  }}
                                >
                                  {isSaving ? "Saving..." : "Update"}
                                </button>
                                <button
                                  type="button"
                                  onClick={handleCancelEditDomain}
                                  disabled={isSaving}
                                  style={{
                                    padding: "5px 10px",
                                    borderRadius: 6,
                                    border: "1px solid var(--border)",
                                    background: "transparent",
                                    color: "var(--text)",
                                    fontSize: 11,
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
                                  onClick={() => handleStartEditDomain(domain)}
                                  disabled={!!domainEditId || isDeleting}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    padding: "5px 10px",
                                    borderRadius: 6,
                                    border: "1px solid var(--border)",
                                    background: "transparent",
                                    color: "var(--text)",
                                    fontSize: 11,
                                    fontWeight: 600,
                                    cursor: !!domainEditId || isDeleting ? "not-allowed" : "pointer",
                                    opacity: !!domainEditId || isDeleting ? 0.7 : 1,
                                  }}
                                >
                                  <Pencil size={11} />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteDomain(domain)}
                                  disabled={!!domainEditId || isDeleting}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    padding: "5px 10px",
                                    borderRadius: 6,
                                    border: "1px solid rgba(220,38,38,0.35)",
                                    background: "rgba(220,38,38,0.08)",
                                    color: "#dc2626",
                                    fontSize: 11,
                                    fontWeight: 600,
                                    cursor: !!domainEditId || isDeleting ? "not-allowed" : "pointer",
                                    opacity: !!domainEditId || isDeleting ? 0.7 : 1,
                                  }}
                                >
                                  <Trash2 size={11} />
                                  {isDeleting ? "Deleting..." : "Delete"}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {/* Categories — codes are auto-suggested when created from the
          Products page, but categories from before that shipped need a
          code backfilled here before their products get a real SKU prefix. */}
      <div style={{ background: "var(--bg)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Tag size={16} color="var(--muted)" />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Categories</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>SKU-prefix codes for product categories — backfill any missing here</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
              {categoriesList.length} total
            </div>
          </div>

          <div style={{ padding: 16, borderBottom: "1px solid var(--border)", display: "flex", gap: 8 }}>
            <input
              style={{ ...inputStyle, margin: 0 }}
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="Add a new category"
            />
            <input
              style={{ ...inputStyle, margin: 0, width: 70, textAlign: "center", textTransform: "uppercase" }}
              value={newCategoryCode}
              onChange={(e) => setNewCategoryCode(e.target.value.slice(0, 4))}
              placeholder="Code"
              maxLength={4}
              title="SKU-prefix code — auto-suggested if left blank"
            />
            <button
              type="button"
              onClick={handleAddCategory}
              disabled={addingCategory}
              style={{
                padding: "8px 14px",
                background: "#1E2938",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: addingCategory ? "not-allowed" : "pointer",
                opacity: addingCategory ? 0.7 : 1,
                whiteSpace: "nowrap",
              }}
            >
              {addingCategory ? "Adding..." : "Add Category"}
            </button>
          </div>

          {catError && (
            <div style={{ margin: 16, marginBottom: 0, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "8px 12px", fontSize: 13, color: "#dc2626" }}>
              {catError}
            </div>
          )}

          {catFetching ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Loading categories...</div>
          ) : categoriesList.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No categories found.</div>
          ) : (
            <div style={sectionListWrap}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={sectionTh}>Category</th>
                    <th style={{ ...sectionTh, width: 90 }}>Code</th>
                    <th style={{ ...sectionTh, width: 170 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {categoriesList.map((cat, i) => {
                    const isSaving = catSavingId === cat.category_id;
                    const isEditing = catEditId === cat.category_id;

                    const changed = isEditing && (catEditName.trim() !== cat.category_name || catEditCode.trim().toUpperCase() !== (cat.code || ""));

                    return (
                      <tr key={cat.category_id} style={{ borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                        <td style={sectionTd}>
                          {isEditing ? (
                            <input
                              style={sectionCellInput}
                              value={catEditName}
                              onChange={(e) => setCatEditName(e.target.value)}
                              autoFocus
                            />
                          ) : (
                            cat.category_name
                          )}
                        </td>
                        <td style={sectionTd}>
                          {isEditing ? (
                            <input
                              style={{ ...sectionCellInput, textAlign: "center", textTransform: "uppercase" }}
                              value={catEditCode}
                              onChange={(e) => setCatEditCode(e.target.value.slice(0, 4))}
                              maxLength={4}
                            />
                          ) : (
                            <span style={{ color: cat.code ? "var(--muted)" : "#dc2626", fontWeight: 600 }}>{cat.code || "—"}</span>
                          )}
                        </td>
                        <td style={sectionTd}>
                          <div style={{ display: "flex", gap: 6 }}>
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={handleUpdateCategory}
                                  disabled={isSaving || !changed || catEditName.trim() === ""}
                                  style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "#1E2938", color: "#fff", fontSize: 11, fontWeight: 600, cursor: isSaving || !changed || catEditName.trim() === "" ? "not-allowed" : "pointer", opacity: isSaving || !changed || catEditName.trim() === "" ? 0.7 : 1 }}
                                >
                                  {isSaving ? "Saving..." : "Update"}
                                </button>
                                <button
                                  type="button"
                                  onClick={handleCancelEditCategory}
                                  disabled={isSaving}
                                  style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", fontSize: 11, fontWeight: 600, cursor: isSaving ? "not-allowed" : "pointer", opacity: isSaving ? 0.7 : 1 }}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleStartEditCategory(cat)}
                                disabled={!!catEditId}
                                style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", fontSize: 11, fontWeight: 600, cursor: !!catEditId ? "not-allowed" : "pointer", opacity: !!catEditId ? 0.7 : 1 }}
                              >
                                <Pencil size={11} />
                                Edit
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>
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
                <select style={inputStyle} value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value, domain_id: e.target.value === "super_admin" ? "" : f.domain_id }))}>
                  <option value="user">User</option>
                  <option value="super_admin">System Administrator</option>
                </select>
              </div>
              {editForm.role === "user" && (
                <div>
                  <label style={labelStyle}>COE Domain</label>
                  <select style={inputStyle} value={editForm.domain_id || ""} onChange={e => setEditForm(f => ({ ...f, domain_id: e.target.value }))} required>
                    <option value="">Select a COE domain...</option>
                    {domains.map(d => <option key={d.domain_id} value={d.domain_id}>{d.domain_name} ({d.room_name})</option>)}
                  </select>
                </div>
              )}
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
