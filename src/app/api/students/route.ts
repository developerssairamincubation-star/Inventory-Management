import { NextRequest } from 'next/server'
import { asc, eq, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { students, departments } from '@/db/schema'
import { requireUser } from '@/lib/authz'
import { ok, created, fromError } from '@/lib/api/response'
import { ApiError } from '@/lib/api/errors'
import { decodeStudentIdCode, normalizeStudentIdCode } from '@/lib/studentIdCode'
import { parseBody, escapeLike, uuid } from '@/lib/validation'
import { requestIdFrom } from '@/lib/logger'

const MAX_PAGE_SIZE = 100

const studentSelection = {
  student_id: students.student_id,
  name: students.name,
  student_id_code: students.student_id_code,
  department_id: students.department_id,
  email: students.email,
  phone_number: students.phone_number,
  departments: { department_name: departments.department_name },
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(req.url)
    const rawSearch = searchParams.get('search')?.trim() || ''
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || MAX_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    const offset = Math.max(Number(searchParams.get('offset')) || 0, 0)

    // `%` and `_` were passed through unescaped. Never SQL injection (Drizzle
    // parameterises), but a lone `%` forced a full-table wildcard scan across
    // columns with no supporting index.
    const search = rawSearch ? escapeLike(rawSearch) : ''

    const where = search
      ? or(
          ilike(students.name, `%${search}%`),
          ilike(students.email, `%${search}%`),
          ilike(students.student_id_code, `%${search}%`),
        )
      : undefined

    // Paginated. This returned every student — name, email, and phone — in
    // one unbounded response to any signed-in user.
    const rows = await db
      .select(studentSelection)
      .from(students)
      .leftJoin(departments, eq(departments.department_id, students.department_id))
      .where(where)
      .orderBy(asc(students.name))
      .limit(limit)
      .offset(offset)

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(students)
      .where(where)

    return ok({ students: rows, total, limit, offset })
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(req), userId: auth.user.user_id, route: 'GET /api/students' })
  }
}

const createStudentSchema = z.object({
  name: z.string().trim().min(1).max(200).nullish(),
  email: z.email().max(255).nullish(),
  phone_number: z.string().trim().max(30).nullish(),
  department_id: uuid.nullish(),
  student_id_code: z.string().trim().max(20).nullish(),
})

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response

  try {
    const body = await parseBody(req, createStudentSchema)
    let department_id: string | null = body.department_id ?? null
    let student_id_code: string | null = null

    // A decodable student_id_code can resolve department_id on its own, so
    // department_id is only required outright when no code is given —
    // matching the relaxed decode-first rule POST /api/lending uses when it
    // creates a student from a scan.
    if (body.student_id_code) {
      student_id_code = normalizeStudentIdCode(body.student_id_code)
      const decoded = decodeStudentIdCode(student_id_code)
      if (!decoded) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Unrecognized student ID format')
      }

      if (!department_id) {
        const [dept] = await db
          .select({ department_id: departments.department_id })
          .from(departments)
          .where(eq(departments.code, decoded.deptCode))
        if (!dept) {
          throw new ApiError(422, 'UNKNOWN_DEPARTMENT_CODE', `Unknown department code "${decoded.deptCode}" — check Admin Settings`)
        }
        department_id = dept.department_id
      }

      const [existingByCode] = await db
        .select({ student_id: students.student_id })
        .from(students)
        .where(eq(students.student_id_code, student_id_code))
        .limit(1)
      if (existingByCode) {
        throw new ApiError(409, 'CONFLICT', 'A student with this ID code already exists')
      }
    }

    if (!department_id) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'department_id is required, directly or via a decodable student_id_code')
    }

    const [inserted] = await db
      .insert(students)
      .values({
        name: body.name || null,
        student_id_code,
        department_id,
        email: body.email || null,
        phone_number: body.phone_number || null,
      })
      .returning()

    const [row] = await db
      .select(studentSelection)
      .from(students)
      .leftJoin(departments, eq(departments.department_id, students.department_id))
      .where(eq(students.student_id, inserted.student_id))

    return created(row)
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(req), userId: auth.user.user_id, route: 'POST /api/students' })
  }
}
