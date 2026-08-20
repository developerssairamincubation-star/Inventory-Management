"use client";

import { useEffect, useState, useCallback } from "react";
import { authFetch } from "@/contexts/UserContext";
import { extractErrorMessage } from "@/lib/extractErrorMessage";
import { useToast } from "@/components/ui/Toast";
import { Plus, Pencil, Search, Users, Upload } from "lucide-react";
import UploadStudentsCsvModal from "@/components/UploadStudentsCsvModal";
import { usePagination } from "@/hooks/usePagination";
import Pagination from "@/components/Pagination";

type Department = { department_id: string; department_name: string; code: string | null };

type Student = {
  student_id: string;
  name: string | null;
  student_id_code: string | null;
  email: string | null;
  phone_number: string | null;
  department_id: string | null;
  departments: { department_name: string } | null;
};

type StudentForm = {
  name: string;
  student_id_code: string;
  email: string;
  phone_number: string;
  department_id: string;
};

const EMPTY_FORM: StudentForm = {
  name: "",
  student_id_code: "",
  email: "",
  phone_number: "",
  department_id: "",
};

// Row/column sizing matches the Entry and Returnable tables — same
// compact bordered cells instead of the wider card-style padding.
const th: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 10,
  fontWeight: 600,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  border: "1px solid #E5E7EB",
  textAlign: "left",
  whiteSpace: "nowrap",
  userSelect: "none",
};
const td: React.CSSProperties = { padding: "7px 10px", fontSize: 12, color: "var(--fg)", border: "1px solid #E5E7EB" };

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [search, setSearch] = useState("");
  const [fetching, setFetching] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [form, setForm] = useState<StudentForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [decodeInfo, setDecodeInfo] = useState<{ departmentName: string | null; error: string | null } | null>(null);
  const { showToast } = useToast();

  const loadStudents = useCallback(async (q?: string) => {
    setFetching(true);
    try {
      const url = q ? `/api/students?search=${encodeURIComponent(q)}` : "/api/students";
      const res = await authFetch(url);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(extractErrorMessage(data, "Failed to load students"));
      }
      // The endpoint is paginated now and returns { students, total, limit,
      // offset }; the array form is still accepted so an older cached bundle
      // doesn't blank the page mid-deploy.
      setStudents(Array.isArray(data) ? data : Array.isArray(data?.students) ? data.students : []);
    } catch (err) {
      // This page's `error` state is only ever rendered inside the Add/Edit
      // modals, which aren't open during the initial list load — a toast is
      // the only way this failure is actually visible to the user.
      console.error("Failed to load students:", err);
      showToast(err instanceof Error ? err.message : "Failed to load students", "error");
    } finally {
      setFetching(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadStudents();
    authFetch("/api/departments")
      .then(r => r.ok ? r.json() : [])
      .then(d => setDepartments(Array.isArray(d) ? d : []))
      .catch((err) => console.error("Failed to fetch departments:", err));
  }, [loadStudents]);

  useEffect(() => {
    const t = setTimeout(() => loadStudents(search || undefined), 300);
    return () => clearTimeout(t);
  }, [search, loadStudents]);

  const { page, setPage, totalPages, pageRows, showAll, setShowAll, startIdx, endIdx, total } = usePagination(students, { pageSize: 50 });

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await authFetch("/api/students", {
        method: "POST",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(extractErrorMessage(data, "Failed to create student"));
      setShowAdd(false);
      setForm(EMPTY_FORM);
      await loadStudents(search || undefined);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editStudent) return;
    setSaving(true);
    setError("");
    try {
      const res = await authFetch(`/api/students/${editStudent.student_id}`, {
        method: "PUT",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(extractErrorMessage(data, "Failed to update student"));
      setEditStudent(null);
      await loadStudents(search || undefined);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function openEdit(s: Student) {
    setEditStudent(s);
    setForm({
      name: s.name || "",
      student_id_code: s.student_id_code || "",
      email: s.email || "",
      phone_number: s.phone_number || "",
      department_id: s.department_id || "",
    });
    setDecodeInfo(null);
    setError("");
  }

  function openAdd() {
    setForm(EMPTY_FORM);
    setDecodeInfo(null);
    setError("");
    setShowAdd(true);
  }

  // Typed or scanned the same way — a barcode scanner just types characters
  // + Enter into whatever input is focused. Fills department automatically;
  // only prefills the name if it's currently blank, never overwrites one
  // the admin already typed.
  async function decodeIdCode() {
    const code = form.student_id_code.trim();
    if (!code) {
      setDecodeInfo(null);
      return;
    }
    setDecoding(true);
    setDecodeInfo(null);
    try {
      const res = await authFetch("/api/students/decode", {
        method: "POST",
        body: JSON.stringify({ student_id_code: code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDecodeInfo({ departmentName: null, error: extractErrorMessage(data, "Unrecognized student ID format") });
        return;
      }
      if (data.error) {
        setDecodeInfo({ departmentName: null, error: data.error });
        return;
      }
      setForm(f => ({
        ...f,
        department_id: data.department_id || f.department_id,
        name: !f.name && data.student_name ? data.student_name : f.name,
      }));
      setDecodeInfo({ departmentName: data.department_name, error: null });
    } catch {
      setDecodeInfo({ departmentName: null, error: "Failed to decode student ID" });
    } finally {
      setDecoding(false);
    }
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
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", margin: 0 }}>Student Management</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>
            Manage student records and department assignments
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <a
            href="/templates/students-sample.csv"
            download
            style={{ fontSize: 12, color: "var(--accent)", textDecoration: "underline" }}
          >
            Download sample CSV
          </a>
          <button
            onClick={() => setShowCsvModal(true)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 16px", background: "var(--fg)", color: "#fff",
              border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            <Upload size={15} /> Bulk Upload
          </button>
          <button
            onClick={openAdd}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 16px", background: "#1E2938", color: "#fff",
              border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            <Plus size={15} /> Add Student
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total Students", value: students.length },
          { label: "With Email", value: students.filter(s => s.email).length },
          { label: "Departments", value: new Set(students.map(s => s.department_id).filter(Boolean)).size },
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
        ) : students.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <Users size={36} style={{ color: "var(--muted)", marginBottom: 12 }} />
            <p style={{ fontSize: 14, color: "var(--muted)", margin: 0 }}>No students found</p>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 50 }}>S.No</th>
                {["Name", "Student ID Code", "Department", "Email", "Phone", "Actions"].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((s, i) => (
                <tr key={s.student_id}>
                  <td style={{ ...td, color: "var(--muted)" }}>{startIdx + i + 1}</td>
                  <td style={td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{
                        width: 22, height: 22, borderRadius: "50%", background: "#1E2938",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0,
                      }}>
                        {(s.name || "?").charAt(0).toUpperCase()}
                      </div>
                      <span style={{ fontWeight: 500, color: "var(--fg)" }}>{s.name || "—"}</span>
                    </div>
                  </td>
                  <td style={{ ...td, fontFamily: "monospace" }}>{s.student_id_code || "—"}</td>
                  <td style={td}>
                    {s.departments?.department_name || "—"}
                  </td>
                  <td style={td}>{s.email || "—"}</td>
                  <td style={td}>{s.phone_number || "—"}</td>
                  <td style={td}>
                    <button
                      onClick={() => openEdit(s)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        padding: "3px 10px", background: "transparent", border: "1px solid var(--border)",
                        borderRadius: 6, fontSize: 11, fontWeight: 500, color: "var(--text)", cursor: "pointer",
                      }}
                    >
                      <Pencil size={11} /> Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!fetching && students.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--muted)" }}>
            <span>{total > 0 ? `Showing ${showAll ? total : Math.min(startIdx + 1, total)}–${showAll ? total : Math.min(endIdx, total)} of ${total}` : ""}</span>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} showAll={showAll} onToggleShowAll={setShowAll} />
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAdd && (
        <Modal title="Add New Student" onClose={() => setShowAdd(false)}>
          {error && <ErrorBox msg={error} />}
          <form onSubmit={handleAdd} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Student ID Code (type or scan)" labelStyle={labelStyle}>
              <input
                style={{ ...inputStyle, fontFamily: "monospace" }}
                value={form.student_id_code}
                onChange={e => { setForm(f => ({ ...f, student_id_code: e.target.value })); setDecodeInfo(null); }}
                onBlur={decodeIdCode}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); decodeIdCode(); } }}
                placeholder="e.g. sit21cs025"
                autoFocus
              />
              {decoding && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Decoding…</div>}
              {decodeInfo?.departmentName && (
                <div style={{ fontSize: 11, color: "#16a34a", marginTop: 4 }}>Resolved department: {decodeInfo.departmentName}</div>
              )}
              {decodeInfo?.error && (
                <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>{decodeInfo.error}</div>
              )}
            </Field>
            <Field label="Full Name" labelStyle={labelStyle}>
              <input style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="Enter full name" />
            </Field>
            <Field label="Department" labelStyle={labelStyle}>
              <select style={inputStyle} value={form.department_id} onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}>
                <option value="">— Select Department —</option>
                {departments.map(d => <option key={d.department_id} value={d.department_id}>{d.department_name}</option>)}
              </select>
            </Field>
            <Field label="Email" labelStyle={labelStyle}>
              <input style={inputStyle} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="student@example.com" />
            </Field>
            <Field label="Phone Number" labelStyle={labelStyle}>
              <input style={inputStyle} value={form.phone_number} onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))} placeholder="+91 98765 43210" />
            </Field>
            <ModalActions onCancel={() => setShowAdd(false)} saving={saving} submitLabel="Add Student" />
          </form>
        </Modal>
      )}

      {/* Edit Modal */}
      {editStudent && (
        <Modal title="Edit Student" onClose={() => setEditStudent(null)}>
          {error && <ErrorBox msg={error} />}
          <form onSubmit={handleEdit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Student ID Code (type or scan)" labelStyle={labelStyle}>
              <input
                style={{ ...inputStyle, fontFamily: "monospace" }}
                value={form.student_id_code}
                onChange={e => { setForm(f => ({ ...f, student_id_code: e.target.value })); setDecodeInfo(null); }}
                onBlur={decodeIdCode}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); decodeIdCode(); } }}
                placeholder="e.g. sit21cs025"
              />
              {decoding && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Decoding…</div>}
              {decodeInfo?.departmentName && (
                <div style={{ fontSize: 11, color: "#16a34a", marginTop: 4 }}>Resolved department: {decodeInfo.departmentName}</div>
              )}
              {decodeInfo?.error && (
                <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>{decodeInfo.error}</div>
              )}
            </Field>
            <Field label="Full Name" labelStyle={labelStyle}>
              <input style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
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
            <ModalActions onCancel={() => setEditStudent(null)} saving={saving} submitLabel="Save Changes" />
          </form>
        </Modal>
      )}

      {showCsvModal && (
        <UploadStudentsCsvModal
          onClose={() => setShowCsvModal(false)}
          onDone={() => loadStudents(search || undefined)}
          departments={departments}
        />
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
