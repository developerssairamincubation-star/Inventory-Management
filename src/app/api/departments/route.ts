import { NextRequest } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { departments } from "@/db/schema";
import { ApiError } from '@/lib/api/errors'
import { created, fromError, ok } from '@/lib/api/response'
import { forbiddenResponse, getAuthUser, unauthorizedResponse } from "@/lib/authMiddleware";

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const rows = await db
      .select({ department_id: departments.department_id, department_name: departments.department_name })
      .from(departments)
      .orderBy(asc(departments.department_name))

    return ok(rows)
  } catch (error) {
    return fromError(error)
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()
  if (user.role !== 'super_admin') return forbiddenResponse()

  try {
    const body = await req.json()
    const department_name = (body?.department_name ?? '').trim()

    if (!department_name) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'department_name is required')
    }

    const [row] = await db
      .insert(departments)
      .values({ department_name })
      .returning({ department_id: departments.department_id, department_name: departments.department_name })

    return created(row)
  } catch (error) {
    return fromError(error)
  }
}
