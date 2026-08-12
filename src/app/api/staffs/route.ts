import { NextRequest } from "next/server";
import { asc, eq, ilike, or } from 'drizzle-orm'
import { db } from '@/db/client'
import { staffs, departments } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'
import { fromError, ok, created } from '@/lib/api/response'
import { getAuthUser, unauthorizedResponse } from "@/lib/authMiddleware";

const staffSelection = {
  staff_id: staffs.staff_id,
  name: staffs.name,
  department_id: staffs.department_id,
  employee_id: staffs.employee_id,
  email: staffs.email,
  phone_number: staffs.phone_number,
  departments: { department_name: departments.department_name },
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.trim() || ''

    const rows = await db
      .select(staffSelection)
      .from(staffs)
      .leftJoin(departments, eq(departments.department_id, staffs.department_id))
      .where(
        search
          ? or(
              ilike(staffs.name, `%${search}%`),
              ilike(staffs.employee_id, `%${search}%`),
              ilike(staffs.email, `%${search}%`),
            )
          : undefined,
      )
      .orderBy(asc(staffs.name))

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
    const { name, employee_id, department_id, email, phone_number } = body

    if (!name || !department_id) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'name and department_id are required')
    }

    if (employee_id) {
      const [existing] = await db
        .select({ staff_id: staffs.staff_id })
        .from(staffs)
        .where(eq(staffs.employee_id, employee_id))
        .limit(1)

      if (existing) {
        throw new ApiError(409, 'CONFLICT', 'A staff member with this employee ID already exists')
      }
    }

    const [inserted] = await db
      .insert(staffs)
      .values({
        name,
        employee_id: employee_id || null,
        department_id,
        email: email || null,
        phone_number: phone_number || null,
      })
      .returning()

    const [row] = await db
      .select(staffSelection)
      .from(staffs)
      .leftJoin(departments, eq(departments.department_id, staffs.department_id))
      .where(eq(staffs.staff_id, inserted.staff_id))

    return created(row)
  } catch (error) {
    return fromError(error)
  }
}
