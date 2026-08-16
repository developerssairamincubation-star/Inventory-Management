'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import { authFetch } from '@/contexts/UserContext'

interface DashboardStats {
  totalProducts: number
  totalStockQuantity: number
  stockDistribution: {
    lent: number
    available: number
    lostDamaged: number
    lost: number
    total: number
  }
  stockDistributionPercentages: {
    lent: number
    available: number
    lostDamaged: number
    lost: number
  }
}

interface OverdueAlert {
  lending_order_id: string
  borrower_name: string
  product_name: string
  due_date: string
}

interface TopLentProduct {
  product_id: string
  product_name: string
  total_lent: number
}

const S = {
  panel: {
    background: '#fff',
    border: '1px solid var(--border)',
    padding: '16px',
  } as React.CSSProperties,
  panelTitle: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.07em',
    color: 'var(--muted)',
    marginBottom: 12,
  } as React.CSSProperties,
  tab: (active: boolean): React.CSSProperties => ({
    padding: '5px 12px',
    fontSize: 11,
    fontWeight: active ? 600 : 400,
    color: active ? '#fff' : 'var(--muted)',
    background: active ? 'var(--fg)' : 'transparent',
    border: '1px solid var(--border)',
    cursor: 'pointer',
    letterSpacing: '0.03em',
    transition: 'background 0.1s',
  }),
}

async function fetchJson<T>(url: string, errorMessage: string): Promise<T> {
  const response = await authFetch(url)
  if (!response.ok) throw new Error(errorMessage)
  return response.json()
}

export default function Dashboard() {
  const [dismissedOverdue, setDismissedOverdue] = useState<Set<string>>(new Set())
  const [topLentFilter, setTopLentFilter] = useState<string>('Monthly')

  // TanStack Query replaces 4 independent useEffect+useState fetches with
  // cached, deduped queries — navigating back to the dashboard within the
  // staleTime window (see QueryProvider) reuses cached data instead of
  // re-fetching from scratch, and concurrent mounts dedupe automatically.
  const statsQuery = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => fetchJson<DashboardStats>('/api/dashboard/stats', 'Failed to fetch stats'),
  })
  const overdueQuery = useQuery({
    queryKey: ['dashboard', 'overdue'],
    queryFn: () => fetchJson<OverdueAlert[]>('/api/dashboard/overdue', 'Failed to fetch overdue alerts'),
  })
  const topLentQuery = useQuery({
    queryKey: ['dashboard', 'top-lent', topLentFilter],
    queryFn: () => fetchJson<TopLentProduct[]>(`/api/dashboard/top-lent?period=${topLentFilter.toLowerCase()}`, 'Failed to fetch top lent products'),
  })

  const stats = statsQuery.data ?? null
  const overdueAlerts = overdueQuery.data ?? []
  const topLentProducts = topLentQuery.data ?? []
  // Only the stats query gates the full-page loading state, matching the
  // original: the other three resolve independently in the background.
  const loading = statsQuery.isLoading

  const dismissOverdue = (id: string) => {
    setDismissedOverdue(prev => new Set(prev).add(id))
  }

  if (loading) {
    return (
      <div style={{ padding: 20, fontSize: 12, color: 'var(--muted)' }}>
        Loading dashboard…
      </div>
    )
  }

  if (!stats) {
    return (
      <div style={{ padding: 20, fontSize: 12, color: 'var(--danger)' }}>
        Failed to load dashboard data.
      </div>
    )
  }

  const grandTotal = stats.stockDistribution.total || 1
  const chartData = [
    { name: 'Available', value: stats.stockDistribution.available, pct: +((stats.stockDistribution.available / grandTotal) * 100).toFixed(1) },
    { name: 'Lent',      value: stats.stockDistribution.lent,      pct: +((stats.stockDistribution.lent / grandTotal) * 100).toFixed(1) },
    { name: 'Damaged',   value: stats.stockDistribution.lostDamaged, pct: +((stats.stockDistribution.lostDamaged / grandTotal) * 100).toFixed(1) },
    { name: 'Lost',      value: stats.stockDistribution.lost,      pct: +((stats.stockDistribution.lost / grandTotal) * 100).toFixed(1) },
  ].filter(d => d.value > 0)

  const COLORS: Record<string, string> = {
    Available: '#1D546D',
    Lent:      '#7AAACE',
    Damaged:   '#dc2626',
    Lost:      '#db8c31',
  }

  const visibleOverdue = overdueAlerts.filter(a => !dismissedOverdue.has(a.lending_order_id))

  const statItems = [
    { label: 'Total Products',    value: stats.totalProducts },
    { label: 'Total Stock',       value: stats.stockDistribution.total },
    { label: 'Available',         value: stats.stockDistribution.available },
    { label: 'Currently Lent',    value: stats.stockDistribution.lent },
    { label: 'Overdue',           value: visibleOverdue.length,         color: visibleOverdue.length > 0 ? 'var(--warn)' : undefined },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: '100%' }}>

      {/* ── Page title bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.01em' }}>
            Dashboard
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            Overview of current inventory status
          </div>
        </div>
      </div>

      {/* ── Stat strip ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          background: '#fff',
          border: '1px solid var(--border)',
        }}
      >
        {statItems.map((s, i) => (
          <div
            key={s.label}
            style={{
              padding: '14px 16px',
              borderRight: i < statItems.length - 1 ? '1px solid var(--border)' : 'none',
            }}
          >
            <div
              style={{
                fontSize: 24,
                fontWeight: 600,
                color: s.color ?? 'var(--fg)',
                letterSpacing: '-0.02em',
                lineHeight: 1,
              }}
            >
              {s.value}
            </div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--muted)',
                marginTop: 5,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Main grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, flex: 1 }}>

        {/* Alerts */}
        <div style={{ ...S.panel, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={S.panelTitle as any}>Overdue Alerts</span>
            {visibleOverdue.length > 0 && (
              <span style={{ background: 'var(--warn)', color: '#fff', borderRadius: 20, padding: '0 5px', fontSize: 10, fontWeight: 700 }}>
                {visibleOverdue.length}
              </span>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {visibleOverdue.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '4px 8px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Borrower</th>
                    <th style={{ padding: '4px 8px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Product</th>
                    <th style={{ padding: '4px 8px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Due</th>
                    <th style={{ padding: '4px 8px', width: 24 }} />
                  </tr>
                </thead>
                <tbody>
                  {visibleOverdue.map((a, i) => {
                    const d = new Date(a.due_date)
                    const dateStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
                    return (
                      <tr key={`${a.lending_order_id}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 8px', fontSize: 12, color: 'var(--fg)' }}>{a.borrower_name}</td>
                        <td style={{ padding: '6px 8px', fontSize: 12, color: 'var(--fg)' }}>{a.product_name}</td>
                        <td style={{ padding: '6px 8px', fontSize: 11, color: 'var(--danger)', whiteSpace: 'nowrap' }}>{dateStr}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                          <button
                            onClick={() => dismissOverdue(a.lending_order_id)}
                            title="Dismiss"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', lineHeight: 1, padding: 2 }}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>
                No overdue alerts
              </div>
            )}
          </div>
        </div>

        {/* Stock Distribution */}
        <div style={{ ...S.panel, display: 'flex', flexDirection: 'column', minHeight: 260 }}>
          <div style={S.panelTitle as any}>Stock Distribution</div>
          {chartData.length > 0 ? (
            <div style={{ flex: 1, minHeight: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={75}
                    paddingAngle={2}
                    minAngle={4}
                    dataKey="value"
                    label={({ name }) => {
                      const item = chartData.find(d => d.name === name)
                      return item ? `${item.pct}%` : ''
                    }}
                    labelLine={false}
                  >
                    {chartData.map((entry) => (
                      <Cell key={entry.name} fill={COLORS[entry.name] ?? '#ccc'} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => {
                      const item = chartData.find(d => d.name === String(name))
                      return [`${value} units (${item?.pct ?? 0}%)`, String(name)]
                    }}
                    contentStyle={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 0 }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    iconSize={8}
                    iconType="circle"
                    formatter={(value) => {
                      const item = chartData.find(d => d.name === value)
                      return <span style={{ fontSize: 11, color: 'var(--fg)' }}>{value}: {item?.value} ({item?.pct}%)</span>
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--muted)' }}>
              No stock data available
            </div>
          )}
        </div>

        {/* Top Lent Products */}
        <div style={{ ...S.panel, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={S.panelTitle as any}>Top Lent Products</span>
            <select
              value={topLentFilter}
              onChange={(e) => setTopLentFilter(e.target.value)}
              style={{
                fontSize: 11,
                border: '1px solid var(--border)',
                padding: '3px 6px',
                color: 'var(--fg)',
                background: 'var(--bg)',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option>Daily</option>
              <option>Weekly</option>
              <option>Monthly</option>
              <option>Yearly</option>
            </select>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {topLentProducts.length > 0 ? (() => {
              const rawTotal = topLentProducts.reduce((s, p) => s + p.total_lent, 0)
              const totalLent = rawTotal || 1
              return topLentProducts.map((p) => {
                const w = Math.max((p.total_lent / totalLent) * 100, 2)
                return (
                  <div key={p.product_id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: 'var(--fg)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.product_name}>
                        {p.product_name}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{p.total_lent}/{rawTotal}</span>
                    </div>
                    <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${w}%`,
                          height: '100%',
                          background: 'var(--accent)',
                          borderRadius: 2,
                          transition: 'width 0.4s ease',
                        }}
                      />
                    </div>
                  </div>
                )
              })
            })() : (
              <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>
                No lending data available
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
