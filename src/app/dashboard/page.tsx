'use client'

import { useEffect, useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'

interface DashboardStats {
  totalProducts: number
  totalStockQuantity: number
  lowStockCount: number
  stockDistribution: {
    lent: number
    available: number
    lostDamaged: number
    total: number
  }
  stockDistributionPercentages: {
    lent: number
    available: number
    lostDamaged: number
  }
}

interface LowStockProduct {
  product_id: string
  product_name: string
  product_code: string
  current_stock: number
  threshold: number
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

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [lowStockProducts, setLowStockProducts] = useState<LowStockProduct[]>([])
  const [overdueAlerts, setOverdueAlerts] = useState<OverdueAlert[]>([])
  const [dismissedOverdue, setDismissedOverdue] = useState<Set<string>>(new Set())
  const [topLentProducts, setTopLentProducts] = useState<TopLentProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [alertTab, setAlertTab] = useState<'low-stock' | 'overdue'>('low-stock')

  const dismissOverdue = (id: string) => {
    setDismissedOverdue(prev => new Set(prev).add(id))
  }

  useEffect(() => {
    fetchDashboardStats()
    fetchLowStockProducts()
    fetchOverdueAlerts()
    fetchTopLentProducts()
  }, [])

  const fetchDashboardStats = async () => {
    try {
      const response = await fetch('/api/dashboard/stats')
      if (!response.ok) throw new Error('Failed to fetch stats')
      const data = await response.json()
      setStats(data)
    } catch (error) {
      console.error('Error fetching dashboard stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchLowStockProducts = async () => {
    try {
      const response = await fetch('/api/dashboard/low-stock')
      if (!response.ok) throw new Error('Failed to fetch low stock products')
      const data = await response.json()
      setLowStockProducts(data)
    } catch (error) {
      console.error('Error fetching low stock products:', error)
    }
  }

  const fetchOverdueAlerts = async () => {
    try {
      const response = await fetch('/api/dashboard/overdue')
      if (!response.ok) throw new Error('Failed to fetch overdue alerts')
      const data = await response.json()
      setOverdueAlerts(data)
    } catch (error) {
      console.error('Error fetching overdue alerts:', error)
    }
  }

  const fetchTopLentProducts = async () => {
    try {
      const response = await fetch('/api/dashboard/top-lent')
      if (!response.ok) throw new Error('Failed to fetch top lent products')
      const data = await response.json()
      setTopLentProducts(data)
    } catch (error) {
      console.error('Error fetching top lent products:', error)
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-gray-600">Loading dashboard...</div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="p-6">
        <div className="text-red-600">Failed to load dashboard data</div>
      </div>
    )
  }

  // Prepare data for donut chart
  const grandTotal = stats.stockDistribution.total || 1
  const chartData = [
    {
      name: 'Available',
      value: stats.stockDistribution.available,
      percentage: parseFloat(((stats.stockDistribution.available / grandTotal) * 100).toFixed(1)),
    },
    {
      name: 'Lent',
      value: stats.stockDistribution.lent,
      percentage: parseFloat(((stats.stockDistribution.lent / grandTotal) * 100).toFixed(1)),
    },
    {
      name: 'Damaged',
      value: stats.stockDistribution.lostDamaged,
      percentage: parseFloat(((stats.stockDistribution.lostDamaged / grandTotal) * 100).toFixed(1)),
    },
  ].filter(item => item.value > 0) // Only show non-zero values

  const COLORS = {
    'Available': '#3b82f6', // blue
    'Lent': '#6b7280', // gray
    'Damaged': '#ef4444', // red
  }

  return (
    <div className="p-4 bg-gray-50 h-full overflow-hidden flex flex-col">
      <h1 className="text-2xl font-bold mb-3 text-gray-900">Dashboard</h1>

      {/* Top Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
        {/* Total Products at Stock */}
        <div className="bg-gray-200 rounded-lg p-6 shadow">
          <h3 className="text-blue-600 text-sm font-medium mb-2">Total products at stock</h3>
          <p className="text-blue-600 text-4xl font-bold">{stats.totalProducts}</p>
        </div>

        {/* Total Stock Quantity */}
        <div className="bg-gray-200 rounded-lg p-6 shadow">
          <h3 className="text-blue-600 text-sm font-medium mb-2">Total Stock quantity</h3>
          <p className="text-blue-600 text-4xl font-bold">{stats.totalStockQuantity}</p>
        </div>

        {/* Low Stock Products */}
        <div className="bg-gray-200 rounded-lg p-6 shadow">
          <h3 className="text-blue-600 text-sm font-medium mb-2">Low stock products</h3>
          <p className="text-blue-600 text-4xl font-bold">{stats.lowStockCount}</p>
        </div>
      </div>

      {/* Second Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
        {/* Alerts Box */}
        <div className="bg-gray-200 rounded-lg p-4 shadow flex flex-col min-h-0">
          <h3 className="text-gray-900 text-lg font-semibold mb-3">Alerts</h3>
          
          {/* Toggle Buttons */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setAlertTab('low-stock')}
              className={`flex-1 py-2 px-4 rounded ${
                alertTab === 'low-stock'
                  ? 'bg-red-500 text-white'
                  : 'bg-gray-300 text-gray-700'
              }`}
            >
              Low stock
            </button>
            <button
              onClick={() => setAlertTab('overdue')}
              className={`flex-1 py-2 px-4 rounded ${
                alertTab === 'overdue'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-300 text-gray-700'
              }`}
            >
              Overdue
            </button>
          </div>

          {/* Alert Content */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {alertTab === 'low-stock' ? (
              <div className="space-y-2">
                {lowStockProducts.length > 0 ? (
                  lowStockProducts.map((product) => (
                    <div 
                      key={product.product_id} 
                      className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm"
                    >
                      <div className="flex items-start gap-2">
                        <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <div className="flex-1">
                          <p className="text-red-800 font-medium">
                            {product.product_name} is on low stock
                          </p>
                          <p className="text-red-600 text-xs mt-1">
                            Current: {product.current_stock} units (Threshold: {product.threshold})
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-gray-500 text-sm py-4 text-center">
                    No low stock alerts
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {overdueAlerts.filter(a => !dismissedOverdue.has(a.lending_order_id)).length > 0 ? (
                  overdueAlerts
                    .filter(a => !dismissedOverdue.has(a.lending_order_id))
                    .map((alert, index) => (
                    <div
                      key={`${alert.lending_order_id}-${index}`}
                      className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm"
                    >
                      <div className="flex items-start gap-2">
                        <svg className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                        </svg>
                        <div className="flex-1">
                          <p className="text-orange-800 font-medium">
                            {alert.borrower_name} did not return {alert.product_name} within {(() => { const d = new Date(alert.due_date); const day = String(d.getDate()).padStart(2, '0'); const month = String(d.getMonth() + 1).padStart(2, '0'); const year = d.getFullYear(); return `${day}/${month}/${year}`; })()}
                          </p>
                        </div>
                        <button
                          onClick={() => dismissOverdue(alert.lending_order_id)}
                          className="ml-1 flex-shrink-0 text-orange-400 hover:text-orange-700 transition-colors"
                          title="Dismiss"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-gray-500 text-sm py-4 text-center">
                    No overdue alerts
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Stock Status Distribution */}
        <div className="bg-gray-200 rounded-lg p-4 shadow flex flex-col min-h-0">
          <h3 className="text-gray-900 text-lg font-semibold mb-3">Stock status distribution</h3>
          
          {chartData.length > 0 ? (
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={2}
                    minAngle={5}
                    dataKey="value"
                    label={({ percentage }) => `${percentage}%`}
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[entry.name as keyof typeof COLORS]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number, name: string) => {
                      const item = chartData.find(d => d.name === name)
                      return [`${value} items (${item?.percentage ?? 0}%)`, 'Quantity']
                    }}
                  />
                  <Legend 
                    verticalAlign="bottom" 
                    height={36}
                    formatter={(value) => {
                      const item = chartData.find(d => d.name === value)
                      return `${value}: ${item?.value || 0} (${item?.percentage ?? 0}%)`
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex items-center justify-center text-gray-500">
              No stock data available
            </div>
          )}
        </div>

        {/* Top Lent Products */}
        <div className="bg-gray-200 rounded-lg p-4 shadow flex flex-col min-h-0">
          <h3 className="text-gray-900 text-lg font-semibold mb-3">Top lent products</h3>
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
            {topLentProducts.length > 0 ? (
              (() => {
                const totalLent = topLentProducts.reduce((sum, p) => sum + p.total_lent, 0) || 1
                return topLentProducts.map((product) => {
                  const barWidth = Math.max((product.total_lent / totalLent) * 100, 2)
                  return (
                    <div key={product.product_id} className="flex items-center gap-3">
                      <span className="text-sm text-gray-800 w-28 truncate flex-shrink-0" title={product.product_name}>
                        {product.product_name}
                      </span>
                      <div className="flex-1 flex items-center gap-2">
                        <div className="flex-1 bg-gray-300 rounded-full h-3.5 overflow-hidden">
                          <div
                            className="bg-[#3d7a99] h-full rounded-full transition-all"
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-600 w-6 text-right flex-shrink-0">{product.total_lent}</span>
                      </div>
                    </div>
                  )
                })
              })()
            ) : (
              <div className="text-gray-500 text-sm py-4 text-center">
                No lending data available
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  )
}
