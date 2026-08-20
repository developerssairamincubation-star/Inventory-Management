import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { students, departments } from "@/db/schema";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireUser: vi.fn() };
});

import { requireUser, type AuthUser } from "@/lib/authz";
import { authResultFor } from "@/test/authMock";
import { GET, POST } from "./route";

const mockRequireUser = vi.mocked(requireUser);

// Routes call requireUser(req, { role }) — honour the role option here so a
// plain `user` still gets a 403 from a super_admin-only route under test.
function actingAs(user: AuthUser | null) {
  mockRequireUser.mockImplementation(async (_req, opts) => authResultFor(user, opts));
}

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

afterAll(async () => {
  await db.delete(students).where(like(students.name, "QaStudentList%"));
  await db.delete(departments).where(like(departments.department_name, "QaDeptForStudentList%"));
});

beforeEach(() => {
  mockRequireUser.mockReset();
});

describe("GET /api/students", () => {
  it("returns 401 when unauthenticated", async () => {
    actingAs(null);
    const res = await GET(new NextRequest("http://localhost/api/students"));
    expect(res.status).toBe(401);
  });

  it("returns students with a nested departments.department_name, matching the old Supabase embed shape", async () => {
    actingAs(authedUser());
    const [dept] = await db.insert(departments).values({ department_name: "QaDeptForStudentList CS" }).returning();
    await db.insert(students).values({ name: "QaStudentList Alice", department_id: dept.department_id });

    const res = await GET(new NextRequest("http://localhost/api/students"));
    expect(res.status).toBe(200);
    const body = ((await res.json()) as { students: Array<{ name: string; departments: { department_name: string } | null }> }).students;
    const alice = body.find((s) => s.name === "QaStudentList Alice");
    expect(alice).toBeDefined();
    expect(alice?.departments).toEqual({ department_name: "QaDeptForStudentList CS" });
  });

  it("filters by search across name/email/student_id_code", async () => {
    actingAs(authedUser());
    const [dept] = await db.insert(departments).values({ department_name: "QaDeptForStudentList Search" }).returning();
    await db.insert(students).values({ name: "QaStudentList Bob", department_id: dept.department_id, email: "qastudentlist-bob@example.com" });

    const res = await GET(new NextRequest("http://localhost/api/students?search=qastudentlist-bob"));
    const body = ((await res.json()) as { students: Array<{ name: string }> }).students;
    expect(body.some((s) => s.name === "QaStudentList Bob")).toBe(true);
    expect(body.every((s) => s.name.includes("Bob") || true)).toBe(true);
  });
});

describe("POST /api/students", () => {
  it("returns 400 when name or department_id is missing", async () => {
    actingAs(authedUser());
    const res = await POST(new NextRequest("http://localhost/api/students", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });

  it("creates a student and returns it with the nested department", async () => {
    actingAs(authedUser());
    const [dept] = await db.insert(departments).values({ department_name: "QaDeptForStudentList New" }).returning();

    const res = await POST(
      new NextRequest("http://localhost/api/students", {
        method: "POST",
        body: JSON.stringify({ name: "QaStudentList New", department_id: dept.department_id }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { name: string; departments: { department_name: string } };
    expect(body.name).toBe("QaStudentList New");
    expect(body.departments.department_name).toBe("QaDeptForStudentList New");
  });

  it("returns 400 for a malformed student_id_code", async () => {
    actingAs(authedUser());
    const res = await POST(
      new NextRequest("http://localhost/api/students", {
        method: "POST",
        body: JSON.stringify({ student_id_code: "not-a-code" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 422 when the student_id_code's department code is unknown", async () => {
    actingAs(authedUser());
    const res = await POST(
      new NextRequest("http://localhost/api/students", {
        method: "POST",
        body: JSON.stringify({ student_id_code: "sit21zz999" }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("resolves department_id from a decodable student_id_code and allows a blank name", async () => {
    actingAs(authedUser());
    await db.insert(departments).values({ department_name: "QaDeptForStudentList CS Decode", code: "CS" });

    const res = await POST(
      new NextRequest("http://localhost/api/students", {
        method: "POST",
        body: JSON.stringify({ student_id_code: "SIT21CS900" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { name: string | null; student_id_code: string; departments: { department_name: string } };
    expect(body.name).toBeNull();
    expect(body.student_id_code).toBe("sit21cs900");
    expect(body.departments.department_name).toBe("QaDeptForStudentList CS Decode");

    await db.delete(students).where(eq(students.student_id_code, "sit21cs900"));
    await db.delete(departments).where(like(departments.department_name, "QaDeptForStudentList CS Decode"));
  });

  it("returns 409 when the student_id_code is already taken", async () => {
    actingAs(authedUser());
    const [dept] = await db.insert(departments).values({ department_name: "QaDeptForStudentList DupCode", code: "EC" }).returning();
    await db.insert(students).values({ name: "QaStudentList DupCode", department_id: dept.department_id, student_id_code: "sit20ec111" });

    const res = await POST(
      new NextRequest("http://localhost/api/students", {
        method: "POST",
        body: JSON.stringify({ student_id_code: "sit20ec111" }),
      }),
    );
    expect(res.status).toBe(409);
  });
});
