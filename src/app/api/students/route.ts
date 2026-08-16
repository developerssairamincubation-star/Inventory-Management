import { NextRequest } from 'next/server'
import { asc, eq, ilike, or } from 'drizzle-orm'
import { db } from '@/db/client'
import { students, departments } from '@/db/schema'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'
import { ok, created, fromError } from '@/lib/api/response'
import { ApiError } from '@/lib/api/errors'
import { decodeStudentIdCode, normalizeStudentIdCode } from '@/lib/studentIdCode'

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
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.trim() || ''

    const rows = await db
      .select(studentSelection)
      .from(students)
      .leftJoin(departments, eq(departments.department_id, students.department_id))
      .where(
        search
          ? or(
              ilike(students.name, `%${search}%`),
              ilike(students.email, `%${search}%`),
              ilike(students.student_id_code, `%${search}%`),
            )
          : undefined,
      )
      .orderBy(asc(students.name))

    return ok(rows)
  } catch (error) {
    return fromError(error)
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const body = await req.json()
    const { name, email, phone_number } = body
    let department_id: string | null = body.department_id || null
    let student_id_code: string | null = null

    // A decodable student_id_code can resolve department_id on its own, so
    // department_id is only required outright when no code is given —
    // matching the same relaxed-name/decode-first rule POST /api/lending
    // uses when it creates a student from a scan.
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
        name: name || null,
        student_id_code,
        department_id,
        email: email || null,
        phone_number: phone_number || null,
      })
      .returning()

    const [row] = await db
      .select(studentSelection)
      .from(students)
      .leftJoin(departments, eq(departments.department_id, students.department_id))
      .where(eq(students.student_id, inserted.student_id))

    return created(row)
  } catch (error) {
    return fromError(error)
  }
}
