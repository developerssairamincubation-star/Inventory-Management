'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  LineChart, Line, CartesianGrid, XAxis, YAxis,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts'
import {
  Package, Boxes, CheckCircle2, RefreshCcw, AlertTriangle, Users, ClipboardList,
} from 'lucide-react'
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

interface DashboardAnalytics {
  counts: {
    totalStudents: number
    totalDepartments: number
    totalCategories: number
    totalDomains: number
    totalOrders: number
  }
  itemTypeSplit: { returnable: number; consumable: number }
  statusSplit: { pending: number; returned: number; damaged: number; lost: number; consumable: number }
  departmentBreakdown: { department_name: string; code: string | null; total: number; active: number }[]
  categoryBreakdown: { category_name: string; total_products: number; total_stock: number }[]
  monthlyTrend: { key: string; label: string; issued: number; returned: number }[]
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
}

async function fetchJson<T>(url: string, errorMessage: string): Promise<T> {
  const response = await authFetch(url)
  if (!response.ok) throw new Error(errorMessage)
  return response.json()
}

const STATUS_COLORS: Record<string, string> = {
  Pending: '#d97706',
  Returned: '#16a34a',
  Damaged: '#dc2626',
  Lost: '#92400e',
  Consumable: '#7c3aed',
}

const CATEGORY_PALETTE = ['#1a56db', '#16a34a', '#d97706', '#7c3aed', '#dc2626', '#0891b2']

export default function Dashboard() {
  const [dismissedOverdue, setDismissedOverdue] = useState<Set<string>>(new Set())
  const [topLentFilter, setTopLentFilter] = useState<string>('Monthly')

  // TanStack Query replaces independent useEffect+useState fetches with
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
  const analyticsQuery = useQuery({
    queryKey: ['dashboard', 'analytics'],
    queryFn: () => fetchJson<DashboardAnalytics>('/api/dashboard/analytics', 'Failed to fetch analytics'),
  })

  const stats = statsQuery.data ?? null
  const overdueAlerts = overdueQuery.data ?? []
  const topLentProducts = topLentQuery.data ?? []
  const analytics = analyticsQuery.data ?? null
  // Only the stats query gates the full-page loading state, matching the
  // original: the other queries resolve independently in the background.
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
  const stockChartData = [
    { name: 'Available', value: stats.stockDistribution.available, pct: +((stats.stockDistribution.available / grandTotal) * 100).toFixed(1) },
    { name: 'Lent',      value: stats.stockDistribution.lent,      pct: +((stats.stockDistribution.lent / grandTotal) * 100).toFixed(1) },
    { name: 'Damaged',   value: stats.stockDistribution.lostDamaged, pct: +((stats.stockDistribution.lostDamaged / grandTotal) * 100).toFixed(1) },
    { name: 'Lost',      value: stats.stockDistribution.lost,      pct: +((stats.stockDistribution.lost / grandTotal) * 100).toFixed(1) },
  ].filter(d => d.value > 0)

  const STOCK_COLORS: Record<string, string> = {
    Available: '#1D546D',
    Lent:      '#7AAACE',
    Damaged:   '#dc2626',
    Lost:      '#db8c31',
  }

  const visibleOverdue = overdueAlerts.filter(a => !dismissedOverdue.has(a.lending_order_id))

  const statItems = [
    { label: 'Total Products',  value: stats.totalProducts, icon: Package, color: '#1a56db' },
    { label: 'Total Stock',     value: stats.stockDistribution.total, icon: Boxes, color: '#0891b2' },
    { label: 'Available',       value: stats.stockDistribution.available, icon: CheckCircle2, color: '#16a34a' },
    { label: 'Currently Lent',  value: stats.stockDistribution.lent, icon: RefreshCcw, color: '#7c3aed' },
    { label: 'Overdue',         value: visibleOverdue.length, icon: AlertTriangle, color: visibleOverdue.length > 0 ? '#dc2626' : '#6b6b6b' },
    { label: 'Total Students',  value: analytics?.counts.totalStudents ?? '—', icon: Users, color: '#d97706' },
    { label: 'Total Entries',   value: analytics?.counts.totalOrders ?? '—', icon: ClipboardList, color: '#1D546D' },
  ]

  const statusTotal = analytics
    ? analytics.statusSplit.pending + analytics.statusSplit.returned + analytics.statusSplit.damaged + analytics.statusSplit.lost + analytics.statusSplit.consumable
    : 0
  const statusChartData = analytics ? [
    { name: 'Pending',    value: analytics.statusSplit.pending },
    { name: 'Returned',   value: analytics.statusSplit.returned },
    { name: 'Damaged',    value: analytics.statusSplit.damaged },
    { name: 'Lost',       value: analytics.statusSplit.lost },
    { name: 'Consumable', value: analytics.statusSplit.consumable },
  ].filter(d => d.value > 0) : []

  const categoryTotal = analytics ? analytics.categoryBreakdown.reduce((s, c) => s + c.total_stock, 0) || 1 : 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: '100%' }}>

      {/* ── Page title bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.01em' }}>
            Dashboard
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            Real-time overview of inventory, lending activity, and department usage
          </div>
        </div>
      </div>

      {/* ── Stat strip ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${statItems.length}, 1fr)`,
          background: '#fff',
          border: '1px solid var(--border)',
        }}
      >
        {statItems.map((s, i) => {
          const Icon = s.icon
          return (
            <div
              key={s.label}
              style={{
                padding: '14px 16px',
                borderRight: i < statItems.length - 1 ? '1px solid var(--border)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <div style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 6, background: `${s.color}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={15} color={s.color} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                  {s.value}
                </div>
                <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                  {s.label}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Row 1: monthly trend / status split / department activity ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr', gap: 16 }}>

        {/* Monthly lending trend */}
        <div style={{ ...S.panel, display: 'flex', flexDirection: 'column', minHeight: 280 }}>
          <div style={S.panelTitle}>Monthly Lending Activity (12 mo)</div>
          {analytics && analytics.monthlyTrend.some(m => m.issued > 0 || m.returned > 0) ? (
            <div style={{ flex: 1, minHeight: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={analytics.monthlyTrend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 0 }} />
                  <Legend iconSize={8} iconType="circle" formatter={(v) => <span style={{ fontSize: 11, color: 'var(--fg)' }}>{v}</span>} />
                  <Line type="monotone" dataKey="issued" name="Issued" stroke="#1a56db" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="returned" name="Returned" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--muted)' }}>
              No lending activity in the last 12 months
            </div>
          )}
        </div>

        {/* Status split */}
        <div style={{ ...S.panel, display: 'flex', flexDirection: 'column', minHeight: 280 }}>
          <div style={S.panelTitle}>Entry Status Split</div>
          {statusChartData.length > 0 ? (
            <div style={{ flex: 1, minHeight: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={65}
                    paddingAngle={2}
                    minAngle={4}
                    dataKey="value"
                    label={({ value }) => `${Math.round((Number(value) / statusTotal) * 100)}%`}
                    labelLine={false}
                  >
                    {statusChartData.map((entry) => (
                      <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? '#ccc'} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [`${value} (${Math.round((Number(value) / statusTotal) * 100)}%)`, String(name)]}
                    contentStyle={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 0 }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={48}
                    iconSize={8}
                    iconType="circle"
                    formatter={(value) => <span style={{ fontSize: 10.5, color: 'var(--fg)' }}>{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--muted)' }}>
              No entries yet
            </div>
          )}
        </div>

        {/* Department activity radar */}
        <div style={{ ...S.panel, display: 'flex', flexDirection: 'column', minHeight: 280 }}>
          <div style={S.panelTitle}>Department Activity</div>
          {analytics && analytics.departmentBreakdown.length > 0 ? (
            <div style={{ flex: 1, minHeight: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={analytics.departmentBreakdown.map(d => ({ subject: d.code || d.department_name.slice(0, 4).toUpperCase(), Active: d.active, Total: d.total }))}>
                  <PolarGrid stroke="var(--border)" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                  <PolarRadiusAxis tick={{ fontSize: 9, fill: 'var(--muted)' }} axisLine={false} />
                  <Radar name="Active" dataKey="Active" stroke="#16a34a" fill="#16a34a" fillOpacity={0.35} />
                  <Radar name="Total" dataKey="Total" stroke="#1a56db" fill="#1a56db" fillOpacity={0.15} />
                  <Legend iconSize={8} iconType="circle" formatter={(v) => <span style={{ fontSize: 11, color: 'var(--fg)' }}>{v}</span>} />
                  <Tooltip contentStyle={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 0 }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--muted)' }}>
              No department activity yet
            </div>
          )}
        </div>
      </div>

      {/* ── Row 2: stock distribution / category breakdown / top lent ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>

        {/* Stock distribution */}
        <div style={{ ...S.panel, display: 'flex', flexDirection: 'column', minHeight: 260 }}>
          <div style={S.panelTitle}>Stock Distribution</div>
          {stockChartData.length > 0 ? (
            <div style={{ flex: 1, minHeight: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stockChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={65}
                    paddingAngle={2}
                    minAngle={4}
                    dataKey="value"
                    label={({ name }) => {
                      const item = stockChartData.find(d => d.name === name)
                      return item ? `${item.pct}%` : ''
                    }}
                    labelLine={false}
                  >
                    {stockChartData.map((entry) => (
                      <Cell key={entry.name} fill={STOCK_COLORS[entry.name] ?? '#ccc'} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => {
                      const item = stockChartData.find(d => d.name === String(name))
                      return [`${value} units (${item?.pct ?? 0}%)`, String(name)]
                    }}
                    contentStyle={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 0 }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={40}
                    iconSize={8}
                    iconType="circle"
                    formatter={(value) => {
                      const item = stockChartData.find(d => d.name === value)
                      return <span style={{ fontSize: 10.5, color: 'var(--fg)' }}>{value}: {item?.value}</span>
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

        {/* Category breakdown */}
        <div style={{ ...S.panel, display: 'flex', flexDirection: 'column', minHeight: 260 }}>
          <div style={S.panelTitle}>Category Breakdown</div>
          {analytics && analytics.categoryBreakdown.length > 0 ? (
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {analytics.categoryBreakdown.map((c, i) => {
                const pct = Math.round((c.total_stock / categoryTotal) * 100)
                const color = CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]
                return (
                  <div key={c.category_name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                        {c.category_name}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{c.total_stock} ({pct}%)</span>
                    </div>
                    <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(pct, 2)}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.4s ease' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--muted)' }}>
              No category data available
            </div>
          )}
        </div>

        {/* Top Lent Products */}
        <div style={{ ...S.panel, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={S.panelTitle}>Top Lent Products</span>
            <select
              value={topLentFilter}
              onChange={(e) => setTopLentFilter(e.target.value)}
              className="dropdown-control"
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

      {/* ── Row 3: overdue alerts ── */}
      <div style={{ ...S.panel, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={S.panelTitle}>Overdue Alerts</span>
          {visibleOverdue.length > 0 && (
            <span style={{ background: 'var(--warn)', color: '#fff', borderRadius: 20, padding: '0 5px', fontSize: 10, fontWeight: 700 }}>
              {visibleOverdue.length}
            </span>
          )}
        </div>

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
                const dateStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
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

      {/* ── Key performance metrics ── */}
      {analytics && (
        <div>
          <div style={{ ...S.panelTitle, marginBottom: 8 }}>Key Performance Metrics</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {[
              {
                label: 'Top Department',
                value: analytics.departmentBreakdown[0]?.code || analytics.departmentBreakdown[0]?.department_name || '—',
                sub: analytics.departmentBreakdown[0] ? `${analytics.departmentBreakdown[0].total} entries` : 'No activity yet',
                bg: '#eff6ff', fg: '#1a56db',
              },
              {
                label: 'Categories',
                value: analytics.counts.totalCategories,
                sub: 'in catalog',
                bg: '#f0fdf4', fg: '#16a34a',
              },
              {
                label: 'COE Domains',
                value: analytics.counts.totalDomains,
                sub: 'rooms tracked',
                bg: '#fdf4ff', fg: '#7c3aed',
              },
              {
                label: 'Active Rate',
                value: `${statusTotal > 0 ? Math.round(((statusTotal - analytics.statusSplit.returned) / statusTotal) * 100) : 0}%`,
                sub: `${analytics.statusSplit.pending + analytics.statusSplit.consumable} active now`,
                bg: '#fff7ed', fg: '#d97706',
              },
              {
                label: 'Consumables Issued',
                value: analytics.itemTypeSplit.consumable,
                sub: 'units, all-time',
                bg: '#fdf4ff', fg: '#7c3aed',
              },
              {
                label: 'Returnables Issued',
                value: analytics.itemTypeSplit.returnable,
                sub: 'units, all-time',
                bg: '#eff6ff', fg: '#1a56db',
              },
              {
                label: 'Damaged + Lost',
                value: stats.stockDistribution.lostDamaged + stats.stockDistribution.lost,
                sub: 'needs replacement',
                bg: '#fef2f2', fg: '#dc2626',
              },
              {
                label: 'Overdue',
                value: visibleOverdue.length,
                sub: 'needs follow-up',
                bg: visibleOverdue.length > 0 ? '#fef2f2' : '#f7f7f7',
                fg: visibleOverdue.length > 0 ? '#dc2626' : '#6b6b6b',
              },
            ].map((k) => (
              <div key={k.label} style={{ background: k.bg, border: '1px solid var(--border)', padding: '12px 14px' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: k.fg, letterSpacing: '-0.01em' }}>{k.value}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg)', marginTop: 4 }}>{k.label}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>{k.sub}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
