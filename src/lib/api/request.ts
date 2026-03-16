import { ApiError } from '@/lib/api/errors'

export async function parseJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Invalid JSON request body')
  }
}

export function getPeriod(searchParams: URLSearchParams): 'daily' | 'weekly' | 'monthly' | 'yearly' {
  const raw = (searchParams.get('period') || 'monthly').toLowerCase()
  if (raw === 'daily' || raw === 'weekly' || raw === 'monthly' || raw === 'yearly') {
    return raw
  }
  return 'monthly'
}

export function getStartDateByPeriod(period: 'daily' | 'weekly' | 'monthly' | 'yearly'): Date {
  const now = new Date()
  const startDate = new Date(now)

  switch (period) {
    case 'daily':
      startDate.setDate(now.getDate() - 1)
      break
    case 'weekly':
      startDate.setDate(now.getDate() - 7)
      break
    case 'yearly':
      startDate.setFullYear(now.getFullYear() - 1)
      break
    case 'monthly':
    default:
      startDate.setMonth(now.getMonth() - 1)
      break
  }

  return startDate
}
