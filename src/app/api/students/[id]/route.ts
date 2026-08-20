import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { students, departments } from '@/db/schema'
import { requireUser } from '@/lib/authz'
import { ok, fromError } from '@/lib/api/response'
import { ApiError } from '@/lib/api/errors'
import { decodeStudentIdCode, normalizeStudentIdCode } from '@/lib/studentIdCode'
import { parseBody, parseUuidParam, uuid } from '@/lib/validation'
import { requestIdFrom } from '@/lib/logger'

const updateStudentSchema = z
  .object({
    name: z.string().trim().min(1).max(200).nullish(),
    department_id: uuid.nullish(),
    email: z.email().max(255).nullish(),
    phone_number: z.string().trim().max(30).nullish(),
    student_id_code: z.string().trim().max(20).nullish(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Nothing to update' })

/**
 * PUT /api/students/[id]
 *
 * This route used to check only that the caller was signed in — any user
 * could overwrite any student's name, email, phone number, department, and ID
 * code. Student contact details are personal data, so that was unrestricted
 * tampering with it.
 *
 * The rule now mirrors what the lending scan flow already does when it
 * get-or-creates a student: a super_admin may correct anything, while an
 * ordinary user may only *fill in* a field that is currently blank, never
 * overwrite one that already holds a value. That keeps the
 * scan-now-name-later workflow intact without letting anyone rewrite records.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response
  const { user } = auth
  const isAdmin = user.role === 'super_admin'

  try {
    const { id: rawId } = await params
    const id = parseUuidParam(rawId)
    const body = await parseBody(req, updateStudentSchema)

    const row = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(students).where(eq(students.student_id, id)).for('update')
      if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Student not found')

      const updateData: Record<string, unknown> = {}

      // Returns true when a non-admin is allowed to write this field: only if
      // it's currently empty.
      const mayWrite = (current: unknown) => isAdmin || current === null || current === undefined || current === ''

      const assign = (field: 'name' | 'email' | 'phone_number' | 'department_id', value: unknown) => {
        if (value === undefined) return
        if (!mayWrite(existing[field])) {
          throw new ApiError(
            403,
            'FORBIDDEN',
            `This student's ${field.replace('_', ' ')} is already set. Ask a super admin to change it.`,
          )
        }
        updateData[field] = value
      }

      assign('name', body.name)
      assign('email', body.email)
      assign('phone_number', body.phone_number)
      assign('department_id', body.department_id)

      if (body.student_id_code !== undefined) {
        if (!mayWrite(existing.student_id_code)) {
          throw new ApiError(403, 'FORBIDDEN', "This student's ID code is already set. Ask a super admin to change it.")
        }

        if (body.student_id_code) {
          const normalized = normalizeStudentIdCode(body.student_id_code)
          const decoded = decodeStudentIdCode(normalized)
          if (!decoded) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Unrecognized student ID format')
          }

          const [existingByCode] = await tx
            .select({ student_id: students.student_id })
            .from(students)
            .where(eq(students.student_id_code, normalized))
          if (existingByCode && existingByCode.student_id !== id) {
            throw new ApiError(409, 'CONFLICT', 'A student with this ID code already exists')
          }

          updateData.student_id_code = normalized
          if (body.department_id === undefined) {
            const [dept] = await tx
              .select({ department_id: departments.department_id })
              .from(departments)
              .where(eq(departments.code, decoded.deptCode))
            if (dept) updateData.department_id = dept.department_id
          }
        } else {
          updateData.student_id_code = null
        }
      }

      // Drizzle's `.set({})` throws — an empty update used to surface as an
      // opaque 500 rather than a 400.
      if (Object.keys(updateData).length === 0) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'No updatable fields were provided')
      }

      await tx.update(students).set(updateData).where(eq(students.student_id, id))

      const [updated] = await tx
        .select({
          student_id: students.student_id,
          name: students.name,
          student_id_code: students.student_id_code,
          department_id: students.department_id,
          email: students.email,
          phone_number: students.phone_number,
          departments: { department_name: departments.department_name },
        })
        .from(students)
        .leftJoin(departments, eq(departments.department_id, students.department_id))
        .where(eq(students.student_id, id))

      return updated
    })

    return ok(row)
  } catch (error) {
    return fromError(error, { requestId: requestIdFrom(req), userId: user.user_id, route: 'PUT /api/students/[id]' })
  }
}
