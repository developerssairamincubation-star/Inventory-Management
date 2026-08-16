import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { departments } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'
import { fromError, ok } from '@/lib/api/response'
import { forbiddenResponse, getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'
import { normalizeDepartmentCode } from '../route'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()
  if (user.role !== 'super_admin') return forbiddenResponse()

  try {
    const { id } = await params
    const body = await req.json()
    const department_name = (body?.department_name ?? '').trim()

    if (!department_name) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'department_name is required')
    }

    // Only touch `code` if the client actually sent the field — omitting it
    // leaves the existing code alone; sending an empty string clears it.
    const updateData: { department_name: string; code?: string | null } = { department_name }
    if (body?.code !== undefined) {
      const code = normalizeDepartmentCode(body.code)
      if (code) {
        const [existing] = await db
          .select({ department_id: departments.department_id })
          .from(departments)
          .where(eq(departments.code, code))
        if (existing && existing.department_id !== id) {
          throw new ApiError(409, 'CONFLICT', 'A department with this code already exists')
        }
      }
      updateData.code = code
    }

    const [row] = await db
      .update(departments)
      .set(updateData)
      .where(eq(departments.department_id, id))
      .returning({ department_id: departments.department_id, department_name: departments.department_name, code: departments.code })

    if (!row) {
      throw new ApiError(404, 'NOT_FOUND', 'Department not found')
    }

    return ok(row)
  } catch (error) {
    return fromError(error)
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req)
  if (!user) return unauthorizedResponse()
  if (user.role !== 'super_admin') return forbiddenResponse()

  try {
    const { id } = await params

    const [row] = await db
      .delete(departments)
      .where(eq(departments.department_id, id))
      .returning({ department_id: departments.department_id })

    if (!row) {
      throw new ApiError(404, 'NOT_FOUND', 'Department not found or cannot be deleted')
    }

    return ok({ success: true })
  } catch (error) {
    return fromError(error)
  }
}
