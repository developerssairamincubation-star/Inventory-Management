import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { revokeSession } from '@/lib/sessions'
import { clearAuthCookies } from '@/lib/cookies'

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get('refresh_token')?.value
  if (refreshToken) {
    await revokeSession(db, refreshToken)
  }

  const res = NextResponse.json({ success: true })
  clearAuthCookies(res)
  return res
}
