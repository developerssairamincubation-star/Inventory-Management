import { NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { departments } from "@/db/schema";
import { ApiError } from '@/lib/api/errors'
import { created, fromError, ok } from '@/lib/api/response'
import { requireUser } from '@/lib/authz'
import { requestIdFrom } from '@/lib/logger'

const DEPARTMENT_CODE_PATTERN = /^[A-Z]{2}$/

// Validates + uppercases a department code, or throws a 400 ApiError.
// Exported so src/app/api/departments/[id]/route.ts (PUT) can reuse it.
export function normalizeDepartmentCode(rawCode: unknown): string | null {
  if (rawCode === undefined || rawCode === null || rawCode === '') return null
  const code = String(rawCode).trim().toUpperCase()
  if (!DEPARTMENT_CODE_PATTERN.test(code)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'code must be exactly 2 letters')
  }
  return code
}

async function assertDepartmentCodeAvailable(code: string, excludeDepartmentId?: string) {
  const [existing] = await db
    .select({ department_id: departments.department_id })
    .from(departments)
    .where(eq(departments.code, code))

  if (existing && existing.department_id !== excludeDepartmentId) {
    throw new ApiError(409, 'CONFLICT', 'A department with this code already exists')
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response

  try {
    const rows = await db
      .select({ department_id: departments.department_id, department_name: departments.department_name, code: departments.code })
      .from(departments)
      .orderBy(asc(departments.department_name))

    return ok(rows)
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(req), route: 'departments' })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req, { role: 'super_admin' })
  if (!auth.ok) return auth.response

  try {
    const body = await req.json()
    const department_name = (body?.department_name ?? '').trim()
    const code = normalizeDepartmentCode(body?.code)

    if (!department_name) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'department_name is required')
    }
    if (code) await assertDepartmentCodeAvailable(code)

    const [row] = await db
      .insert(departments)
      .values({ department_name, code })
      .returning({ department_id: departments.department_id, department_name: departments.department_name, code: departments.code })

    return created(row)
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(req), route: 'departments' })
  }
}
