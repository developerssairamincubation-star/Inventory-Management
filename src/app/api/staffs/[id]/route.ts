import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { staffs, departments } from '@/db/schema'
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
    if (body.employee_id !== undefined) updateData.employee_id = body.employee_id
    if (body.department_id !== undefined) updateData.department_id = body.department_id
    if (body.email !== undefined) updateData.email = body.email
    if (body.phone_number !== undefined) updateData.phone_number = body.phone_number

    const [updated] = await db.update(staffs).set(updateData).where(eq(staffs.staff_id, id)).returning()

    if (!updated) {
      throw new ApiError(404, 'NOT_FOUND', 'Staff not found')
    }

    const [row] = await db
      .select({
        staff_id: staffs.staff_id,
        name: staffs.name,
        department_id: staffs.department_id,
        employee_id: staffs.employee_id,
        email: staffs.email,
        phone_number: staffs.phone_number,
        departments: { department_name: departments.department_name },
      })
      .from(staffs)
      .leftJoin(departments, eq(departments.department_id, staffs.department_id))
      .where(eq(staffs.staff_id, id))

    return ok(row)
  } catch (error) {
    return fromError(error)
  }
}
