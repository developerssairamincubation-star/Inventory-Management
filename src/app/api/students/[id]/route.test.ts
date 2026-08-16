import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { like } from "drizzle-orm";
import { db } from "@/db/client";
import { students, departments } from "@/db/schema";

vi.mock("@/lib/authMiddleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authMiddleware")>();
  return { ...actual, getAuthUser: vi.fn() };
});

import { getAuthUser, type AuthUser } from "@/lib/authMiddleware";
import { PUT } from "./route";

const mockGetAuthUser = vi.mocked(getAuthUser);

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
  await db.delete(students).where(like(students.name, "QaStudentItem%"));
  await db.delete(departments).where(like(departments.department_name, "QaDeptForStudentItem%"));
});

beforeEach(() => {
  mockGetAuthUser.mockReset();
});

describe("PUT /api/students/[id]", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await PUT(new NextRequest("http://localhost/api/students/x", { method: "PUT", body: "{}" }), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(401);
  });

  it("updates only the provided fields and returns 404 for an unknown id", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const res = await PUT(
      new NextRequest("http://localhost/api/students/x", { method: "PUT", body: JSON.stringify({ name: "y" }) }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );
    expect(res.status).toBe(404);
  });

  it("partially updates a student", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const [dept] = await db.insert(departments).values({ department_name: "QaDeptForStudentItem A" }).returning();
    const [student] = await db
      .insert(students)
      .values({ name: "QaStudentItem Before", department_id: dept.department_id })
      .returning();

    const res = await PUT(
      new NextRequest(`http://localhost/api/students/${student.student_id}`, {
        method: "PUT",
        body: JSON.stringify({ phone_number: "555-0100" }),
      }),
      { params: Promise.resolve({ id: student.student_id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; phone_number: string };
    expect(body.name).toBe("QaStudentItem Before");
    expect(body.phone_number).toBe("555-0100");
  });

  it("returns 400 for a malformed student_id_code", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const [dept] = await db.insert(departments).values({ department_name: "QaDeptForStudentItem Malformed" }).returning();
    const [student] = await db
      .insert(students)
      .values({ name: "QaStudentItem Malformed", department_id: dept.department_id })
      .returning();

    const res = await PUT(
      new NextRequest(`http://localhost/api/students/${student.student_id}`, {
        method: "PUT",
        body: JSON.stringify({ student_id_code: "nope" }),
      }),
      { params: Promise.resolve({ id: student.student_id }) },
    );
    expect(res.status).toBe(400);
  });

  it("resolves department_id from a decodable student_id_code", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const [dept] = await db.insert(departments).values({ department_name: "QaDeptForStudentItem Decode", code: "ME" }).returning();
    const [otherDept] = await db.insert(departments).values({ department_name: "QaDeptForStudentItem DecodeOther" }).returning();
    const [student] = await db
      .insert(students)
      .values({ name: "QaStudentItem Decode", department_id: otherDept.department_id })
      .returning();

    const res = await PUT(
      new NextRequest(`http://localhost/api/students/${student.student_id}`, {
        method: "PUT",
        body: JSON.stringify({ student_id_code: "SIT21ME050" }),
      }),
      { params: Promise.resolve({ id: student.student_id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { student_id_code: string; department_id: string };
    expect(body.student_id_code).toBe("sit21me050");
    expect(body.department_id).toBe(dept.department_id);
  });

  it("returns 409 when the student_id_code is already taken by another student", async () => {
    mockGetAuthUser.mockResolvedValue(authedUser());
    const [dept] = await db.insert(departments).values({ department_name: "QaDeptForStudentItem Conflict", code: "IT" }).returning();
    await db.insert(students).values({ name: "QaStudentItem ConflictTaken", department_id: dept.department_id, student_id_code: "sit20it222" });
    const [student] = await db
      .insert(students)
      .values({ name: "QaStudentItem ConflictSubject", department_id: dept.department_id })
      .returning();

    const res = await PUT(
      new NextRequest(`http://localhost/api/students/${student.student_id}`, {
        method: "PUT",
        body: JSON.stringify({ student_id_code: "sit20it222" }),
      }),
      { params: Promise.resolve({ id: student.student_id }) },
    );
    expect(res.status).toBe(409);
  });
});
