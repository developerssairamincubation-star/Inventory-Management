'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

interface ProductDetail {
  product_id: string
  product_name: string
  product_code: string
  serial_number: string | null
  unit_cost: number
  low_stock_threshold: number | null
  returnable: boolean | null
  image_url: string | null
  created_at: string
  stocks: {
    quantity: number
    damaged_quantity: number
    lost_quantity: number
  } | null
}

interface LendingSummary {
  totalLent: number
  returned: number
}

interface BorrowRecord {
  sno: number
  lending_order_id: string
  borrower_name: string
  borrower_type: 'STUDENT' | 'STAFF'
  department: string
  borrow_date: string
  return_date: string | null
  due_date: string | null
  status: string
  quantity: number
  original_quantity: number
  damaged_quantity: number
  lost_quantity: number
  mentor: string
}

const ROWS_PER_PAGE = 10

type LendingPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly'

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const month = d.toLocaleString('en-US', { month: 'short' })
  const day = String(d.getDate()).padStart(2, '0')
  const year = d.getFullYear()
  return `${month} ${day}, ${year}`
}

function StatusBadge({ status }: { status: string }) {
  const s = status?.toUpperCase()
  if (s === 'RETURNED') return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
      Returned (Good)
    </span>
  )
  if (s === 'RETURNED_DAMAGED') return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-teal-100 text-teal-700">
      <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
      Returned (Damaged)
    </span>
  )
  if (s === 'RETURNED_LOST') return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
      Returned (Lost)
    </span>
  )
  if (s === 'PENDING' || s === 'ACTIVE' || s === 'PARTIALLY_DAMAGED' || s === 'PARTIALLY_LOST') return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700">
      <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
      {s === 'PARTIALLY_DAMAGED' ? 'Partially Damaged' : s === 'PARTIALLY_LOST' ? 'Partially Lost' : 'Pending'}
    </span>
  )
  if (s === 'OVERDUE') return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
      Overdue
    </span>
  )
  if (s === 'DAMAGED') return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">
      <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
      Damaged
    </span>
  )
  if (s === 'LOST') return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
      Lost
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
      {status}
    </span>
  )
}

// ─── Lending Status Display (mirrors lending page) ──────────────────────────
function LendingStatusDisplay({ record }: { record: BorrowRecord }) {
  const PENDING_STATUSES = ['PENDING', 'PARTIALLY_RETURNED', 'PARTIALLY_DAMAGED', 'PARTIALLY_LOST']
  const FINAL_STATUSES = ['RETURNED', 'RETURNED_DAMAGED', 'RETURNED_LOST', 'DAMAGED', 'LOST', 'CONSUMABLE']

  if (PENDING_STATUSES.includes(record.status)) {
    const colorClass =
      record.status === 'PARTIALLY_DAMAGED'
        ? 'border-red-400 bg-red-50 text-red-700'
        : record.status === 'PARTIALLY_LOST'
        ? 'border-orange-400 bg-orange-50 text-orange-700'
        : record.status === 'PARTIALLY_RETURNED'
        ? 'border-blue-400 bg-blue-50 text-blue-700'
        : 'border-yellow-400 bg-yellow-100 text-yellow-800'
    const label =
      record.status === 'PENDING'
        ? 'PENDING'
        : record.status === 'PARTIALLY_RETURNED'
        ? 'PARTIALLY RETURNED'
        : record.status === 'PARTIALLY_DAMAGED'
        ? 'PARTIALLY DAMAGED'
        : 'PARTIALLY LOST'
    return (
      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded border ${colorClass}`}>
        {label}
      </span>
    )
  }

  if (FINAL_STATUSES.includes(record.status)) {
    // Use original_quantity for accurate count; fall back to current quantity
    const orig = (record.original_quantity != null && record.original_quantity > 0)
      ? record.original_quantity
      : (record.quantity || 0)
    const d = record.damaged_quantity || 0
    const l = record.lost_quantity || 0
    // returnedCount = whatever wasn't damaged or lost
    const returnedCount = Math.max(0, orig - d - l)
    const hasPills = returnedCount > 0 || d > 0 || l > 0

    if (hasPills) {
      return (
        <div className="flex flex-col gap-1">
          {returnedCount > 0 && (
            <span className="inline-flex items-center justify-center px-3 py-1 text-xs font-semibold rounded-full bg-green-200 text-green-900 whitespace-nowrap">
              {returnedCount} Returned
            </span>
          )}
          {d > 0 && (
            <span className="inline-flex items-center justify-center px-3 py-1 text-xs font-semibold rounded-full bg-red-200 text-red-900 whitespace-nowrap">
              {d} Damaged
            </span>
          )}
          {l > 0 && (
            <span className="inline-flex items-center justify-center px-3 py-1 text-xs font-semibold rounded-full bg-[#c4a8a8] text-[#3b1f1f] whitespace-nowrap">
              {l} Lost
            </span>
          )}
        </div>
      )
    }

    // Consumable or a completed item with zero breakdown data
    const fallbackColor = record.status === 'CONSUMABLE' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-700'
    return (
      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${fallbackColor}`}>
        {record.status}
      </span>
    )
  }

  return (
    <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-700">
      {record.status || '—'}
    </span>
  )
}

// ─── Edit Modal ──────────────────────────────────────────────────────────────
function EditModal({
  product,
  onClose,
  onSaved,
}: {
  product: ProductDetail
  onClose: () => void
  onSaved: (updated: ProductDetail) => void
}) {
  const [name, setName] = useState(product.product_name)
  const [serial, setSerial] = useState(product.serial_number ?? '')
  const [cost, setCost] = useState<number | ''>(product.unit_cost ?? '')
  const [threshold, setThreshold] = useState<number | ''>(product.low_stock_threshold ?? '')
  const [returnable, setReturnable] = useState<boolean | null>(product.returnable ?? null)
  const [saving, setSaving] = useState(false)

  // Image upload state
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(product.image_url ?? null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      // Upload new image to S3 first (if a new file was selected)
      let image_url: string | undefined = undefined
      if (imageFile) {
        const formData = new FormData()
        formData.append('file', imageFile)
        formData.append('folder', 'products')
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData })
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json()
          image_url = uploadData.url
        } else {
          console.error('Image upload failed:', await uploadRes.text())
        }
      }

      const res = await fetch(`/api/products/${product.product_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: name,
          serial_number: serial || null,
          unit_cost: cost === '' ? undefined : Number(cost),
          low_stock_threshold: threshold === '' ? undefined : Number(threshold),
          returnable: returnable,
          // Only send image_url if a new file was uploaded
          ...(image_url !== undefined ? { image_url } : {}),
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const updated = await res.json()
      onSaved({ ...product, ...updated })
    } catch (err) {
      console.error('Failed to update product:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl p-6 w-[90%] max-w-lg shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-gray-900">Edit Product</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
            <input required value={name} onChange={e => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-slate-800 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Serial Number / SKU</label>
            <input value={serial} onChange={e => setSerial(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-slate-800 focus:border-transparent" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Unit Cost (₹)</label>
              <input type="number" step="0.01" min={0} value={cost as any}
                onChange={e => setCost(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-slate-800 focus:border-transparent" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Low Stock Threshold</label>
              <input type="number" min={0} value={threshold as any}
                onChange={e => setThreshold(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-slate-800 focus:border-transparent" />
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Product Type</p>
            <div className="flex gap-6">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="radio" name="returnable" checked={returnable === true} onChange={() => setReturnable(true)} className="accent-slate-800" />
                <span className="text-sm text-gray-800">Returnable</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="radio" name="returnable" checked={returnable === false} onChange={() => setReturnable(false)} className="accent-slate-800" />
                <span className="text-sm text-gray-800">Consumable</span>
              </label>
            </div>
          </div>

          {/* Product Image Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Product Photo</label>
            {imagePreview && (
              <div className="mb-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="product preview" className="h-28 w-28 object-contain rounded border border-gray-200" />
              </div>
            )}
            <label className="inline-flex items-center gap-2 cursor-pointer px-3 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <span className="text-sm text-gray-700">{imageFile ? imageFile.name : 'Change photo'}</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  setImageFile(f)
                  if (f) {
                    const fr = new FileReader()
                    fr.onload = () => setImagePreview(typeof fr.result === 'string' ? fr.result : null)
                    fr.readAsDataURL(f)
                  }
                }}
              />
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm hover:bg-slate-900 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [lendingSummary, setLendingSummary] = useState<LendingSummary>({ totalLent: 0, returned: 0 })
  const [borrowingHistory, setBorrowingHistory] = useState<BorrowRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lendingPeriod, setLendingPeriod] = useState<LendingPeriod>('monthly')

  // UI state
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    if (!id) return
    fetchProductDetail(lendingPeriod)
  }, [id])

  useEffect(() => {
    if (!id || loading) return
    fetchLendingSummary(lendingPeriod)
  }, [lendingPeriod])

  const fetchProductDetail = async (period: LendingPeriod = 'monthly') => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/products/${id}?period=${period}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Product not found')
      }
      const data = await res.json()
      setProduct(data.product)
      setLendingSummary(data.lendingSummary)
      setBorrowingHistory(data.borrowingHistory || [])
      setSelectedImage(data.product.image_url || null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const fetchLendingSummary = async (period: LendingPeriod) => {
    setSummaryLoading(true)
    try {
      const res = await fetch(`/api/products/${id}?period=${period}`)
      if (res.ok) {
        const data = await res.json()
        setLendingSummary(data.lendingSummary)
      }
    } catch (err) {
      console.error('Failed to fetch lending summary:', err)
    } finally {
      setSummaryLoading(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/products/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      router.push('/products')
    } catch (err) {
      console.error('Delete failed:', err)
      setDeleting(false)
      setDeleteConfirm(false)
    }
  }

  // Filtered + paginated rows
  const filtered = borrowingHistory.filter(r => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      r.borrower_name.toLowerCase().includes(q) ||
      r.department.toLowerCase().includes(q) ||
      r.status.toLowerCase().includes(q) ||
      r.borrower_type.toLowerCase().includes(q)
    )
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE))
  const pageRows = filtered.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE)

  // ── Loading / Error ──────────────────────────────────────────────────────
  if (loading) return (
    <div className="p-8 flex items-center gap-3 text-gray-500">
      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
      Loading product details…
    </div>
  )

  if (error || !product) return (
    <div className="p-8">
      <p className="text-red-600 mb-4">{error || 'Product not found.'}</p>
      <button onClick={() => router.push('/products')} className="text-slate-800 underline text-sm">← Back to Product List</button>
    </div>
  )

  const stock = product.stocks?.quantity ?? 0
  const damaged = product.stocks?.damaged_quantity ?? 0
  const lost = product.stocks?.lost_quantity ?? 0
  const threshold = product.low_stock_threshold ?? 0
  const isLow = threshold > 0 && stock <= threshold

  // stock bar width (relative to threshold * 3 or stock, whichever is larger)
  const barMax = Math.max(stock + damaged + lost, threshold * 2, 1)
  const stockBarPct = Math.min(100, (stock / barMax) * 100)

  return (
    <div className="bg-gray-50 -m-6 p-6 min-h-full">
      {/* ── Header ── */}
      <button
        onClick={() => router.push('/products')}
        className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 mb-4 font-medium"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Product List
      </button>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{product.product_name}</h1>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <span className="text-sm text-gray-500">SKU: {product.product_code}</span>
            {product.serial_number && (
              <span className="text-sm text-gray-500">S/N: {product.serial_number}</span>
            )}
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${isLow ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
              {isLow ? 'Low Stock' : 'Active Stock'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit Product
          </button>
          <button
            onClick={() => setDeleteConfirm(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        </div>
      </div>

      {/* ── Info Cards Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        {/* Product Image */}
        <div className="bg-white rounded-2xl shadow overflow-hidden self-start">
          <div className="w-full h-[220px] bg-gray-50 overflow-hidden">
            {selectedImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selectedImage} alt={product.product_name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-gray-300 gap-3">
                <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-sm text-gray-400">No image available</span>
              </div>
            )}
          </div>
        </div>

        {/* Right col: 4 cards in 2×2 */}
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Current Stock */}
          <div className="bg-white rounded-2xl shadow p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-gray-500">Current Stock</p>
              <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
                <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
              </div>
            </div>
            <p className="text-4xl font-bold text-gray-900">{stock} <span className="text-lg font-medium text-gray-400">units</span></p>
            {threshold > 0 && (
              <div className="mt-3">
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${isLow ? 'bg-red-500' : 'bg-blue-500'}`}
                    style={{ width: `${stockBarPct}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">Threshold: {threshold} units</p>
              </div>
            )}
            <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
              <div>
                <span className="font-semibold text-gray-700">{product.unit_cost != null ? `₹${Number(product.unit_cost).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}</span>
                <span className="ml-1 text-gray-400">/ unit</span>
              </div>
            </div>
          </div>

          {/* Lending Summary */}
          <div className="bg-white rounded-2xl shadow p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-gray-500">Lending Summary</p>
              <div className="flex items-center gap-2">
                <select
                  value={lendingPeriod}
                  onChange={e => setLendingPeriod(e.target.value as LendingPeriod)}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-600 focus:outline-none focus:ring-2 focus:ring-slate-800 bg-white"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
                <div className="w-8 h-8 rounded-full bg-purple-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                </div>
              </div>
            </div>
            {summaryLoading ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Loading…
              </div>
            ) : (
              <div className="flex items-center gap-8 mt-2">
                <div>
                  <p className="text-xs text-gray-400 mb-1">Total Lent</p>
                  <p className="text-3xl font-bold text-gray-900">{lendingSummary.totalLent}</p>
                </div>
                <div className="w-px h-12 bg-gray-100" />
                <div>
                  <p className="text-xs text-gray-400 mb-1">Returned</p>
                  <p className="text-3xl font-bold text-gray-900">{lendingSummary.returned}</p>
                </div>
              </div>
            )}
          </div>

          {/* Policy Status */}
          <div className="bg-white rounded-2xl shadow p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-gray-500">Policy Status</p>
              <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center">
                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
            </div>
            <div className="mt-1">
              {product.returnable === true && (
                <>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-green-100 text-green-700">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    Returnable Item
                  </span>
                  <p className="text-xs text-gray-400 mt-2">Standard 14-day borrowing period applies to students and staff.</p>
                </>
              )}
              {product.returnable === false && (
                <>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-purple-100 text-purple-700">
                    <span className="w-2 h-2 rounded-full bg-purple-500" />
                    Consumable Item
                  </span>
                </>
              )}
              {product.returnable === null && (
                <span className="text-sm text-gray-400">Policy not set</span>
              )}
            </div>
          </div>

          {/* Damaged & Lost Quantity */}
          <div className="bg-white rounded-2xl shadow p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-gray-500">Stock Issues</p>
              <div className="w-8 h-8 rounded-full bg-orange-50 flex items-center justify-center">
                <svg className="w-4 h-4 text-orange-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div>
                <p className="text-xs text-gray-400 mb-1">Damaged</p>
                <p className="text-3xl font-bold text-orange-600">{damaged} <span className="text-sm font-medium text-gray-400">units</span></p>
              </div>
              <div className="w-px h-10 bg-gray-100" />
              <div>
                <p className="text-xs text-gray-400 mb-1">Lost</p>
                <p className="text-3xl font-bold text-red-600">{lost} <span className="text-sm font-medium text-gray-400">units</span></p>
              </div>
            </div>
            {(damaged > 0 || lost > 0) ? (
              <p className="mt-3 text-xs font-medium text-orange-500 flex items-center gap-1">
              </p>
            ) : (
              <p className="mt-3 text-xs text-gray-400">No damaged or lost units reported</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Borrowing History ── */}
      <div className="bg-white rounded-2xl shadow">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between px-6 py-4 border-b border-gray-100 gap-3">
          <h2 className="text-lg font-bold text-gray-900">Borrowing History</h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search history..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1) }}
                className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-800 w-52"
              />
            </div>
            <button className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 010 2H4a1 1 0 01-1-1zm3 4a1 1 0 011-1h10a1 1 0 010 2H7a1 1 0 01-1-1zm3 4a1 1 0 011-1h4a1 1 0 010 2h-4a1 1 0 01-1-1z" />
              </svg>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-gray-400 tracking-wide uppercase border-b border-gray-100">
                <th className="px-6 py-3 text-left w-16">S.No</th>
                <th className="px-6 py-3 text-left">Borrower Name</th>
                <th className="px-6 py-3 text-left">Type</th>
                <th className="px-6 py-3 text-left">Department</th>
                <th className="px-6 py-3 text-center">Borrowed</th>
                <th className="px-6 py-3 text-center">Returned</th>
                <th className="px-6 py-3 text-center">Damaged</th>
                <th className="px-6 py-3 text-center">Lost</th>
                <th className="px-6 py-3 text-center">Balance</th>
                <th className="px-6 py-3 text-left">Borrow Date</th>
                <th className="px-6 py-3 text-left">Return Date</th>
                <th className="px-6 py-3 text-left">Status</th>
                <th className="px-6 py-3 text-left">Mentor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-6 py-12 text-center text-gray-400">
                    {searchQuery ? 'No records match your search.' : 'No borrowing history found.'}
                  </td>
                </tr>
              ) : (
                pageRows.map((row) => {
                  const isOverdue = row.status?.toUpperCase() === 'OVERDUE'
                  return (
                    <tr key={row.lending_order_id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-6 py-4 text-gray-400">{String(row.sno).padStart(2, '0')}</td>
                      <td className="px-6 py-4 font-semibold text-gray-900">{row.borrower_name}</td>
                      <td className="px-6 py-4">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${row.borrower_type === 'STUDENT' ? 'text-blue-600 bg-blue-50' : 'text-green-600 bg-green-50'}`}>
                          {row.borrower_type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-600">{row.department}</td>
                      {/* ── Quantity breakdown ── */}
                      {(() => {
                        const FULLY_RETURNED_STATUSES = ['RETURNED', 'RETURNED_DAMAGED', 'RETURNED_LOST']
                        const borrowed = (row.original_quantity != null && row.original_quantity > 0)
                          ? row.original_quantity
                          : row.quantity
                        const damaged = row.damaged_quantity || 0
                        const lost = row.lost_quantity || 0
                        const isFullyReturned = FULLY_RETURNED_STATUSES.includes(row.status)
                        const returned = isFullyReturned
                          ? Math.max(0, borrowed - damaged - lost)
                          : Math.max(0, borrowed - row.quantity - damaged - lost)
                        const balance = isFullyReturned ? 0 : row.quantity
                        return (
                          <>
                            <td className="px-6 py-4 text-center text-gray-700">{borrowed}</td>
                            <td className="px-6 py-4 text-center">
                              <span className={returned > 0 ? 'font-semibold text-green-700' : 'text-gray-300'}>
                                {returned > 0 ? returned : '—'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className={damaged > 0 ? 'font-semibold text-red-600' : 'text-gray-300'}>
                                {damaged > 0 ? damaged : '—'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className={lost > 0 ? 'font-semibold text-orange-600' : 'text-gray-300'}>
                                {lost > 0 ? lost : '—'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className={balance > 0 ? 'font-semibold text-yellow-700' : 'text-gray-300'}>
                                {balance > 0 ? balance : '—'}
                              </span>
                            </td>
                          </>
                        )
                      })()}
                      <td className="px-6 py-4 text-gray-600">{formatDate(row.borrow_date)}</td>
                      <td className={`px-6 py-4 font-medium ${isOverdue ? 'text-red-500' : 'text-gray-600'}`}>
                        {row.return_date ? formatDate(row.return_date) : (row.due_date ? formatDate(row.due_date) : '—')}
                      </td>
                      <td className="px-6 py-4">
                        <LendingStatusDisplay record={row} />
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700">{row.mentor || '—'}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
          <p className="text-sm text-gray-500">
            Showing {filtered.length === 0 ? 0 : (currentPage - 1) * ROWS_PER_PAGE + 1}–{Math.min(currentPage * ROWS_PER_PAGE, filtered.length)} of {filtered.length} records
          </p>
          <div className="flex items-center gap-1">
            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(p => p - 1)}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 text-gray-700"
            >
              Previous
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const page = totalPages <= 5 ? i + 1 : currentPage <= 3 ? i + 1 : currentPage + i - 2
              if (page < 1 || page > totalPages) return null
              return (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-9 h-9 text-sm rounded-lg font-medium ${currentPage === page ? 'bg-slate-800 text-white' : 'border border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                >
                  {page}
                </button>
              )
            })}
            <button
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(p => p + 1)}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 text-gray-700"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* ── Edit Modal ── */}
      {editOpen && product && (
        <EditModal
          product={product}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => {
            setProduct(prev => prev ? { ...prev, ...updated } : updated)
            setEditOpen(false)
          }}
        />
      )}

      {/* ── Delete Confirm Modal ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-6 w-[90%] max-w-sm shadow-xl text-center">
            <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Product?</h3>
            <p className="text-sm text-gray-500 mb-6">
              This will permanently delete <strong>{product.product_name}</strong> and all related stock and lending records. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setDeleteConfirm(false)}
                disabled={deleting}
                className="px-5 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-5 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
