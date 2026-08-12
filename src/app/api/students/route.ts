import { NextRequest } from 'next/server'
import { asc, eq, ilike, or } from 'drizzle-orm'
import { db } from '@/db/client'
import { students, departments } from '@/db/schema'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'
import { ok, created, fromError } from '@/lib/api/response'
import { ApiError } from '@/lib/api/errors'

const studentSelection = {
  student_id: students.student_id,
  name: students.name,
  student_number: students.student_number,
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
              ilike(students.student_number, `%${search}%`),
              ilike(students.email, `%${search}%`),
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
    const { name, student_number, department_id, email, phone_number } = body

    if (!name || !department_id) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'name and department_id are required')
    }

    if (student_number) {
      const [existing] = await db
        .select({ student_id: students.student_id })
        .from(students)
        .where(eq(students.student_number, student_number))
        .limit(1)

      if (existing) {
        throw new ApiError(409, 'CONFLICT', 'A student with this student number already exists')
      }
    }

    const [inserted] = await db
      .insert(students)
      .values({
        name,
        student_number: student_number || null,
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
