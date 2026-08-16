import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { departments, students } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'
import { fromError, ok } from '@/lib/api/response'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'
import { decodeStudentIdCode, normalizeStudentIdCode } from '@/lib/studentIdCode'

// Read-only: decodes a scanned/typed student ID code and reports what's
// known about it, but never creates a student row — that happens
// transactionally inside POST /api/lending, which is the only place a
// student record actually gets created from this data.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const body = await req.json()
    const rawCode = body?.student_id_code
    if (!rawCode || typeof rawCode !== 'string') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'student_id_code is required')
    }

    const decoded = decodeStudentIdCode(rawCode)
    if (!decoded) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Unrecognized student ID format')
    }

    const [department] = await db
      .select({ department_id: departments.department_id, department_name: departments.department_name })
      .from(departments)
      .where(eq(departments.code, decoded.deptCode))

    const [existingStudent] = await db
      .select({ student_id: students.student_id, name: students.name })
      .from(students)
      .where(eq(students.student_id_code, normalizeStudentIdCode(rawCode)))

    if (!department) {
      // Still return the parsed pieces so the UI can show what it *did*
      // understand, alongside a "check Admin Settings" hint.
      return ok({
        valid: true,
        college_code: decoded.collegeCode,
        college_name: decoded.collegeName,
        join_year: decoded.joinYear,
        dept_code: decoded.deptCode,
        department_id: null,
        department_name: null,
        year_of_study: decoded.yearOfStudy,
        serial: decoded.serial,
        existing: !!existingStudent,
        student_name: existingStudent?.name ?? null,
        error: 'unknown department code — check Admin Settings',
      })
    }

    return ok({
      valid: true,
      college_code: decoded.collegeCode,
      college_name: decoded.collegeName,
      join_year: decoded.joinYear,
      dept_code: decoded.deptCode,
      department_id: department.department_id,
      department_name: department.department_name,
      year_of_study: decoded.yearOfStudy,
      serial: decoded.serial,
      existing: !!existingStudent,
      student_name: existingStudent?.name ?? null,
    })
  } catch (error) {
    return fromError(error)
  }
}
