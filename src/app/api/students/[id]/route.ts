import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { students, departments } from '@/db/schema'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'
import { ok, fromError } from '@/lib/api/response'
import { ApiError } from '@/lib/api/errors'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const { id } = await params
    const body = await req.json()

    const updateData: Record<string, unknown> = {}
    if (body.name !== undefined) updateData.name = body.name
    if (body.student_number !== undefined) updateData.student_number = body.student_number
    if (body.department_id !== undefined) updateData.department_id = body.department_id
    if (body.email !== undefined) updateData.email = body.email
    if (body.phone_number !== undefined) updateData.phone_number = body.phone_number

    const [updated] = await db.update(students).set(updateData).where(eq(students.student_id, id)).returning()

    if (!updated) {
      throw new ApiError(404, 'NOT_FOUND', 'Student not found')
    }

    const [row] = await db
      .select({
        student_id: students.student_id,
        name: students.name,
        student_number: students.student_number,
        department_id: students.department_id,
        email: students.email,
        phone_number: students.phone_number,
        departments: { department_name: departments.department_name },
      })
      .from(students)
      .leftJoin(departments, eq(departments.department_id, students.department_id))
      .where(eq(students.student_id, id))

    return ok(row)
  } catch (error) {
    return fromError(error)
  }
}
