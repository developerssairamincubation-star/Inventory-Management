import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { departments, students } from "@/db/schema";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireUser: vi.fn() };
});

import { requireUser, type AuthUser } from "@/lib/authz";
import { authResultFor } from "@/test/authMock";
import { POST } from "./route";

const mockRequireUser = vi.mocked(requireUser);

// Routes call requireUser(req, { role }) — honour the role option here so a
// plain `user` still gets a 403 from a super_admin-only route under test.
function actingAs(user: AuthUser | null) {
  mockRequireUser.mockImplementation(async (_req, opts) => authResultFor(user, opts));
}
let DEPT_ID: string;

function authedUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    user_id: "11111111-1111-1111-1111-111111111111",
    email: "user@example.com",
    full_name: "Test User",
    role: "user",
    is_active: true,
    domain_id: null,
    ...overrides,
  };
}

beforeAll(async () => {
  const [dept] = await db.insert(departments).values({ department_name: "Decode Route Dept", code: "DR" }).returning();
  DEPT_ID = dept.department_id;
});

afterAll(async () => {
  await db.delete(students).where(eq(students.department_id, DEPT_ID));
  await db.delete(departments).where(eq(departments.department_id, DEPT_ID));
});

beforeEach(() => {
  mockRequireUser.mockReset();
});

describe("POST /api/students/decode", () => {
  it("returns 401 when unauthenticated", async () => {
    actingAs(null);
    const res = await POST(new NextRequest("http://localhost/api/students/decode", { method: "POST", body: JSON.stringify({ student_id_code: "sit24dr001" }) }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for a malformed code", async () => {
    actingAs(authedUser());
    const res = await POST(new NextRequest("http://localhost/api/students/decode", { method: "POST", body: JSON.stringify({ student_id_code: "bogus" }) }));
    expect(res.status).toBe(400);
  });

  it("decodes a valid code with a known department, existing:false for a new ID", async () => {
    actingAs(authedUser());
    const res = await POST(new NextRequest("http://localhost/api/students/decode", { method: "POST", body: JSON.stringify({ student_id_code: "sit24dr001" }) }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { department_id: string; department_name: string; existing: boolean; college_name: string };
    expect(body.department_id).toBe(DEPT_ID);
    expect(body.department_name).toBe("Decode Route Dept");
    expect(body.existing).toBe(false);
    expect(body.college_name).toBe("Sri Sai Ram Institute Of Technology");
  });

  it("decodes a valid code with an unknown department code, department_id null", async () => {
    actingAs(authedUser());
    const res = await POST(new NextRequest("http://localhost/api/students/decode", { method: "POST", body: JSON.stringify({ student_id_code: "sit24zz001" }) }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { department_id: string | null };
    expect(body.department_id).toBeNull();
  });

  it("decodes a lateral-entry code (L after the college code) and reports is_lateral_entry", async () => {
    actingAs(authedUser());
    const res = await POST(new NextRequest("http://localhost/api/students/decode", { method: "POST", body: JSON.stringify({ student_id_code: "sitl24dr001" }) }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { department_id: string; is_lateral_entry: boolean };
    expect(body.department_id).toBe(DEPT_ID);
    expect(body.is_lateral_entry).toBe(true);
  });

  it("reports existing:true and the stored name for a known student ID", async () => {
    actingAs(authedUser());
    await db.insert(students).values({ student_id_code: "sit24dr002", name: "Decode Route Student", department_id: DEPT_ID });

    const res = await POST(new NextRequest("http://localhost/api/students/decode", { method: "POST", body: JSON.stringify({ student_id_code: "sit24dr002" }) }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { existing: boolean; student_name: string | null };
    expect(body.existing).toBe(true);
    expect(body.student_name).toBe("Decode Route Student");
  });
});
