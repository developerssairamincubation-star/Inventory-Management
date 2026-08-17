import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { revokeSession } from '@/lib/sessions'
import { clearAuthCookies } from '@/lib/cookies'
import { fromError } from '@/lib/api/response'

export async function POST(req: NextRequest) {
  try {
    const refreshToken = req.cookies.get('refresh_token')?.value
    if (refreshToken) {
      await revokeSession(db, refreshToken)
    }

    const res = NextResponse.json({ success: true })
    clearAuthCookies(res)
    return res
  } catch (error) {
    return fromError(error)
  }
}
