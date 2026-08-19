'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ImageCropModal from '@/components/ImageCropModal'
import BarcodeLabel from '@/components/BarcodeLabel'
import TransferStockModal from '@/components/TransferStockModal'
import { authFetch } from '@/contexts/UserContext'
import { uploadFile } from '@/lib/uploadClient'
import { useToast } from '@/components/ui/Toast'
import { extractErrorMessage } from '@/lib/extractErrorMessage'
import { ArrowUpNarrowWide, ArrowUpWideNarrow } from 'lucide-react'

interface ProductDetail {
  product_id: string
  product_name: string
  product_code: string
  sku_code: string | null
  description: string | null
  unit_cost: number
  image_url: string | null
  created_at: string
  category_id: string | null
  category_name: string | null
  domain_id: string | null
  domain_name: string | null
  stocks: {
    quantity: number
    damaged_quantity: number
    lost_quantity: number
    location: string | null
  } | null
}

interface TransferRecord {
  transfer_id: string
  quantity: number
  mode: 'full' | 'partial'
  created_at: string
  source_domain_name: string | null
  destination_domain_name: string | null
  transferred_by_name: string | null
}

interface LendingSummary {
  totalLent: number
  returned: number
}

interface BorrowRecord {
  sno: number
  lending_order_id: string
  borrower_name: string
  borrower_type: 'STUDENT'
  department: string
  borrow_date: string
  return_date: string | null
  due_date: string | null
  status: string
  quantity: number
  original_quantity: number
  damaged_quantity: number
  lost_quantity: number
}

const ROWS_PER_PAGE = 20

type LendingPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly'
type SortColH = 'borrow_date' | 'return_date' | 'borrowed' | null
type SortDirH = 'asc' | 'desc'

function matchesStatusFilterH(status: string, filter: string): boolean {
  if (!filter) return true
  const s = status?.toUpperCase() ?? ''
  if (filter === 'CONSUMABLE') return s === 'CONSUMABLE'
  if (filter === 'RETURNED') return ['RETURNED', 'RETURNED_DAMAGED', 'RETURNED_LOST'].includes(s)
  if (filter === 'DAMAGED') return ['DAMAGED', 'PARTIALLY_DAMAGED', 'RETURNED_DAMAGED'].includes(s)
  if (filter === 'LOST') return ['LOST', 'PARTIALLY_LOST', 'RETURNED_LOST'].includes(s)
  if (filter === 'PENDING') return ['PENDING', 'PARTIALLY_RETURNED', 'PARTIALLY_DAMAGED', 'PARTIALLY_LOST'].includes(s)
  return true
}

const selectStyleH: React.CSSProperties = {
  fontSize: 12,
  border: '1px solid var(--border)',
  padding: '5px 8px',
  color: 'var(--fg)',
  background: '#fff',
  outline: 'none',
  cursor: 'pointer',
  minWidth: 120,
}

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

// â”€â”€â”€ Lending Status Display (mirrors lending page) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function LendingStatusDisplay({ record }: { record: BorrowRecord }) {
  const PENDING_STATUSES = ['PENDING', 'PARTIALLY_RETURNED', 'PARTIALLY_DAMAGED', 'PARTIALLY_LOST']
  const FINAL_STATUSES = ['RETURNED', 'RETURNED_DAMAGED', 'RETURNED_LOST', 'DAMAGED', 'LOST', 'CONSUMABLE']

  if (PENDING_STATUSES.includes(record.status)) {
    const label =
      record.status === 'PENDING' ? 'PENDING'
      : record.status === 'PARTIALLY_RETURNED' ? 'PARTIALLY RETURNED'
      : record.status === 'PARTIALLY_DAMAGED' ? 'PARTIALLY DAMAGED'
      : 'PARTIALLY LOST'
    const bg =
      record.status === 'PARTIALLY_DAMAGED' ? '#fee2e2' :
      record.status === 'PARTIALLY_LOST' ? '#fef3c7' :
      record.status === 'PARTIALLY_RETURNED' ? '#dbeafe' : '#fef9c3'
    const color =
      record.status === 'PARTIALLY_DAMAGED' ? '#991b1b' :
      record.status === 'PARTIALLY_LOST' ? '#92400e' :
      record.status === 'PARTIALLY_RETURNED' ? '#1e40af' : '#92400e'
    return (
      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: bg, color, whiteSpace: 'nowrap' }}>
        {label}
      </span>
    )
  }

  if (FINAL_STATUSES.includes(record.status)) {
    if (record.status === 'CONSUMABLE') {
      return (
        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: '#ede9fe', color: '#6d28d9', whiteSpace: 'nowrap' }}>
          CONSUMABLE
        </span>
      )
    }
    const orig = (record.original_quantity != null && record.original_quantity > 0)
      ? record.original_quantity : (record.quantity || 0)
    const d = record.damaged_quantity || 0
    const l = record.lost_quantity || 0
    const returnedCount = Math.max(0, orig - d - l)
    const hasPills = returnedCount > 0 || d > 0 || l > 0

    if (hasPills) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {returnedCount > 0 && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: '#dcfce7', color: '#166534', whiteSpace: 'nowrap' }}>{returnedCount} Returned</span>
          )}
          {d > 0 && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: '#fee2e2', color: '#991b1b', whiteSpace: 'nowrap' }}>{d} Damaged</span>
          )}
          {l > 0 && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: '#fef3c7', color: '#92400e', whiteSpace: 'nowrap' }}>{l} Lost</span>
          )}
        </div>
      )
    }
    return (
      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: 'var(--surface)', color: 'var(--muted)' }}>
        {record.status}
      </span>
    )
  }

  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', background: 'var(--surface)', color: 'var(--muted)' }}>
      {record.status || '—'}
    </span>
  )
}

// â”€â”€â”€ Edit Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  const [description, setDescription] = useState(product.description ?? '')
  const [cost, setCost] = useState<number | ''>(product.unit_cost ?? '')
  const [categoryId, setCategoryId] = useState<string>(product.category_id ?? '')
  const [stockQuantity, setStockQuantity] = useState<number | ''>(product.stocks?.quantity ?? '')
  const [location, setLocation] = useState(product.stocks?.location ?? '')
  const [saving, setSaving] = useState(false)
  const { showToast } = useToast()

  // Categories
  const [categories, setCategories] = useState<{category_id: string; category_name: string}[]>([])
  const [showAddCatModal, setShowAddCatModal] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatCode, setNewCatCode] = useState('')
  const [addCatLoading, setAddCatLoading] = useState(false)

  useEffect(() => {
    authFetch('/api/categories')
      .then(r => r.ok ? r.json() : [])
      .then(d => setCategories(Array.isArray(d) ? d : []))
      .catch((err) => console.error('Failed to fetch categories:', err))
  }, [])

  const handleCreateCat = async () => {
    if (!newCatName.trim() || addCatLoading) return
    setAddCatLoading(true)
    try {
      const res = await authFetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_name: newCatName.trim(), code: newCatCode.trim() || undefined }),
      })
      if (res.ok) {
        const created = await res.json()
        setCategories(prev => [...prev, created])
        setCategoryId(created.category_id)
        setNewCatName('')
        setNewCatCode('')
        setShowAddCatModal(false)
      } else {
        const body = await res.json().catch(() => ({}))
        console.error('Failed to create category:', body)
        showToast(extractErrorMessage(body, "Couldn't create the category. Please try again."), 'error')
      }
    } catch (err) {
      console.error('Failed to create category:', err)
      showToast("Couldn't create the category. Please check your connection and try again.", 'error')
    } finally {
      setAddCatLoading(false)
    }
  }

  // Image upload state
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(product.image_url ?? null)
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const [showCropModal, setShowCropModal] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      // Upload new image directly to storage first (if a new file was selected)
      let image_url: string | undefined = undefined
      if (imageFile) {
        try {
          image_url = await uploadFile(imageFile, 'products', authFetch)
        } catch (uploadErr) {
          console.error('Image upload failed:', uploadErr)
        }
      }

      const res = await authFetch(`/api/products/${product.product_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: name,
          description: description || null,
          unit_cost: cost === '' ? undefined : Number(cost),
          category_id: categoryId || null,
          // Only send image_url if a new file was uploaded
          ...(image_url !== undefined ? { image_url } : {}),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(extractErrorMessage(body, 'Failed to update product'))
      }
      const updated = await res.json()
      const originalStock = product.stocks?.quantity ?? 0
      const originalLocation = product.stocks?.location ?? ''
      const stockPatch: Record<string, unknown> = {}
      if (stockQuantity !== '' && Number(stockQuantity) !== originalStock) stockPatch.newStock = Number(stockQuantity)
      if (location.trim() !== originalLocation) stockPatch.location = location.trim() || null
      if (Object.keys(stockPatch).length > 0) {
        const stockRes = await authFetch(`/api/products/${product.product_id}/update-stock`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(stockPatch),
        })
        if (!stockRes.ok) {
          // The product's own name/description/etc. already saved above —
          // only the stock/location half failed, so this warns rather than
          // throwing (which would misleadingly suggest nothing was saved).
          console.error('Failed to update stock/location:', stockRes.status)
          showToast('Product details saved, but the stock/location change failed. Please try again.', 'warning')
        }
      }
      // Include category_name from categories array
      const selectedCategory = categories.find(c => c.category_id === (categoryId || updated.category_id))
      const category_name = selectedCategory ? selectedCategory.category_name : null
      onSaved({
        ...product, ...updated, category_name,
        stocks: {
          quantity: stockQuantity !== '' ? Number(stockQuantity) : originalStock,
          damaged_quantity: product.stocks?.damaged_quantity ?? 0,
          lost_quantity: product.stocks?.lost_quantity ?? 0,
          location: location.trim() || null,
        },
      })
    } catch (err) {
      console.error('Failed to update product:', err)
      showToast(err instanceof Error ? err.message : 'Failed to update product', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}>
      <div style={{ background: '#fff', border: '1px solid var(--border)', padding: 24, width: '90%', maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Edit Product</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--muted)', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Product Name</div>
            <input required value={name} onChange={e => setName(e.target.value)}
              style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', boxSizing: 'border-box' as const }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>SKU</div>
            <div style={{ padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', background: 'var(--surface)' }}>
              {product.sku_code || 'Generated on save'}
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Description (optional)</div>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} maxLength={2000}
              style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', boxSizing: 'border-box' as const, resize: 'vertical' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Unit Cost (₹)</div>
              <input type="number" step="0.01" min={0} value={cost as number | ''}
                onChange={e => setCost(e.target.value === '' ? '' : Number(e.target.value))}
                style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', boxSizing: 'border-box' as const }} />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Current Stock</div>
              <input type="number" min={0} value={stockQuantity as number | ''}
                onChange={e => setStockQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', boxSizing: 'border-box' as const }} />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Location/Rack</div>
              <input value={location} placeholder="e.g. R2" onChange={e => setLocation(e.target.value)}
                style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', boxSizing: 'border-box' as const }} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Category</div>
            <select value={categoryId}
              onChange={e => {
                if (e.target.value === '__add_new__') { setShowAddCatModal(true) }
                else setCategoryId(e.target.value)
              }}
              style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', background: '#fff', boxSizing: 'border-box' as const }}>
              <option value=''>— Select category —</option>
              {categories.map(c => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
              <option value='__add_new__'>+ Add new category…</option>
            </select>
          </div>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Product Photo</div>
            {imagePreview && (
              <div style={{ marginBottom: 8 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="product preview" style={{ height: 96, width: 96, objectFit: 'cover', border: '1px solid var(--border)' }} />
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg)', cursor: 'pointer', padding: '4px 10px', border: '1px solid var(--border)', background: 'var(--surface)' }}>
                Re-Upload
                <input type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null
                    if (f) {
                      const fr = new FileReader()
                      fr.onload = () => {
                        if (typeof fr.result === 'string') {
                          setCropSrc(fr.result)
                          setShowCropModal(true)
                        }
                      }
                      fr.readAsDataURL(f)
                    }
                    // Reset so same file can be re-selected
                    e.target.value = ''
                  }}
                />
              </label>
              {imagePreview && (
                <button type="button" onClick={() => { setCropSrc(imagePreview); setShowCropModal(true); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg)', cursor: 'pointer', padding: '4px 10px', border: '1px solid var(--border)', background: 'var(--surface)' }}>
                  Re-crop
                </button>
              )}
            </div>
          </div>
          {showCropModal && cropSrc && (
            <ImageCropModal
              imageSrc={cropSrc}
              aspect={1}
              onCrop={(dataUrl, file) => {
                setImageFile(file)
                setImagePreview(dataUrl)
                setShowCropModal(false)
                setCropSrc(null)
              }}
              onClose={() => {
                setShowCropModal(false)
                setCropSrc(null)
              }}
            />
          )}
          {/* Add Category Mini Modal */}
          {showAddCatModal && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}>
              <div style={{ background: '#fff', border: '1px solid var(--border)', padding: 24, width: 320 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 14 }}>Add New Category</div>
                <input autoFocus value={newCatName} onChange={e => setNewCatName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateCat(); } }}
                  placeholder='Category name…'
                  style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', marginBottom: 8, boxSizing: 'border-box' as const }} />
                <input value={newCatCode} onChange={e => setNewCatCode(e.target.value.slice(0, 4))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateCat(); } }}
                  placeholder='Code (optional) — SKU prefix'
                  maxLength={4}
                  style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', marginBottom: 12, boxSizing: 'border-box' as const, textTransform: 'uppercase' }} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button type='button' onClick={() => { setShowAddCatModal(false); setNewCatName(''); setNewCatCode(''); }}
                    style={{ padding: '4px 14px', fontSize: 12, border: '1px solid var(--border)', background: '#fff', color: 'var(--fg)', cursor: 'pointer' }}>Cancel</button>
                  <button type='button' onClick={handleCreateCat} disabled={addCatLoading || !newCatName.trim()}
                    style={{ padding: '4px 14px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', opacity: (addCatLoading || !newCatName.trim()) ? 0.5 : 1 }}>
                    {addCatLoading ? 'Adding…' : 'Add'}
                  </button>
                </div>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <button type="button" onClick={onClose}
              style={{ padding: '5px 16px', fontSize: 12, border: '1px solid var(--border)', background: '#fff', color: 'var(--fg)', cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={saving}
              style={{ padding: '5px 16px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', opacity: saving ? 0.5 : 1 }}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
// â”€â”€â”€ Main Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { showToast } = useToast()

  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [lendingSummary, setLendingSummary] = useState<LendingSummary>({ totalLent: 0, returned: 0 })
  const [borrowingHistory, setBorrowingHistory] = useState<BorrowRecord[]>([])
  const [transferHistory, setTransferHistory] = useState<TransferRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lendingPeriod, setLendingPeriod] = useState<LendingPeriod>('monthly')

  // UI state
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [printingBarcode, setPrintingBarcode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [showAll, setShowAll] = useState(false)

  // Filters
  const [statusFilter, setStatusFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('')

  // Sort
  const [sortColH, setSortColH] = useState<SortColH>(null)
  const [sortDirH, setSortDirH] = useState<SortDirH>('asc')

  useEffect(() => {
    if (!id) return
    fetchProductDetail(lendingPeriod)
  }, [id])

  useEffect(() => {
    if (!id || loading) return
    fetchLendingSummary(lendingPeriod)
  }, [lendingPeriod])

  // Print-just-the-label flow: mount the label (hidden via @media print CSS
  // below), trigger the browser print dialog, then unmount once the user is
  // done — no PDF generation needed, plain browser print-to-label-printer.
  useEffect(() => {
    if (!printingBarcode) return
    const handle = window.setTimeout(() => window.print(), 50)
    const onAfterPrint = () => setPrintingBarcode(false)
    window.addEventListener('afterprint', onAfterPrint)
    return () => {
      window.clearTimeout(handle)
      window.removeEventListener('afterprint', onAfterPrint)
    }
  }, [printingBarcode])

  const fetchProductDetail = async (period: LendingPeriod = 'monthly') => {
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch(`/api/products/${id}?period=${period}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Product not found')
      }
      const data = await res.json()
      setProduct(data.product)
      setLendingSummary(data.lendingSummary)
      setBorrowingHistory(data.borrowingHistory || [])
      setTransferHistory(data.transferHistory || [])
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
      const res = await authFetch(`/api/products/${id}?period=${period}`)
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

  const handleTransferred = async () => {
    setTransferOpen(false)
    // A full transfer of a product a non-admin owns moves it out of their
    // own visibility (products are scoped by owning user) — refetching then
    // 404s, so send them back to the list instead of showing an error.
    const res = await authFetch(`/api/products/${id}?period=${lendingPeriod}`)
    if (res.status === 404) {
      showToast('Stock transferred — this item now belongs to another domain.', 'success')
      router.push('/products')
      return
    }
    if (res.ok) {
      const data = await res.json()
      setProduct(data.product)
      setLendingSummary(data.lendingSummary)
      setBorrowingHistory(data.borrowingHistory || [])
      setTransferHistory(data.transferHistory || [])
      setSelectedImage(data.product.image_url || null)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await authFetch(`/api/products/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(extractErrorMessage(body, 'Failed to delete product'))
      }
      router.push('/products')
    } catch (err) {
      console.error('Delete failed:', err)
      showToast(err instanceof Error ? err.message : 'Failed to delete product', 'error')
      setDeleting(false)
      setDeleteConfirm(false)
    }
  }

  // Filtered + paginated rows
  const handleSortH = (col: SortColH) => {
    if (sortColH === col) setSortDirH(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortColH(col); setSortDirH('asc') }
  }

  const SortIconH = ({ col }: { col: SortColH }) => {
    if (sortColH !== col) return <ArrowUpNarrowWide size={11} style={{ opacity: 0.3, flexShrink: 0 }} />
    return sortDirH === 'asc'
      ? <ArrowUpNarrowWide size={11} style={{ flexShrink: 0, color: 'var(--accent)' }} />
      : <ArrowUpWideNarrow size={11} style={{ flexShrink: 0, color: 'var(--accent)' }} />
  }

  const uniqueDepts = Array.from(new Set(borrowingHistory.map(r => r.department).filter(Boolean)))

  let filtered = borrowingHistory.filter(r => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      const match = (
        r.borrower_name.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q) ||
        r.borrower_type.toLowerCase().includes(q)
      )
      if (!match) return false
    }
    if (statusFilter && !matchesStatusFilterH(r.status, statusFilter)) return false
    if (deptFilter && r.department !== deptFilter) return false
    return true
  })

  if (sortColH) {
    filtered = [...filtered].sort((a, b) => {
      let av: number, bv: number
      if (sortColH === 'borrow_date') { av = new Date(a.borrow_date).getTime(); bv = new Date(b.borrow_date).getTime() }
      else if (sortColH === 'return_date') { av = a.return_date ? new Date(a.return_date).getTime() : -Infinity; bv = b.return_date ? new Date(b.return_date).getTime() : -Infinity }
      else { av = a.original_quantity ?? a.quantity; bv = b.original_quantity ?? b.quantity }
      return sortDirH === 'asc' ? av - bv : bv - av
    })
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE))
  const pageRows = showAll ? filtered : filtered.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE)

  // â”€â”€ Loading / Error â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  const handleQuickImageUpload = async (file: File) => {
    try {
      const image_url = await uploadFile(file, 'products', authFetch)
      const res = await authFetch(`/api/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url }),
      })
      if (res.ok) {
        setSelectedImage(image_url)
        setProduct(prev => prev ? { ...prev, image_url } : prev)
      } else {
        console.error('Failed to save product image:', res.status)
        showToast("Couldn't save the image. Please try again.", 'error')
      }
    } catch (err) {
      console.error('Error uploading product image:', err)
      showToast("Couldn't upload the image. Please check your connection and try again.", 'error')
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Back + Header */}
      <button onClick={() => router.push('/products')}
        style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, marginBottom: 0, padding: 0, alignSelf: 'flex-start' }}>
        ← Back to Product List
      </button>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg)' }}>{product.product_name}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            S/N: {product.product_code}
            {product.sku_code && <span style={{ marginLeft: 12 }}>SKU: {product.sku_code}</span>}
          </div>
          {product.description && (
            <div style={{ fontSize: 12, color: 'var(--fg)', marginTop: 6, maxWidth: 480 }}>{product.description}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setPrintingBarcode(true)}
            style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, border: '1px solid var(--border)', background: '#fff', color: 'var(--fg)', cursor: 'pointer' }}>
            Print Barcode
          </button>
          <button onClick={() => setEditOpen(true)}
            style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, border: '1px solid var(--border)', background: '#fff', color: 'var(--fg)', cursor: 'pointer' }}>
            Edit Product
          </button>
          <button onClick={() => setTransferOpen(true)} disabled={(product.stocks?.quantity ?? 0) <= 0}
            style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, border: '1px solid var(--border)', background: '#fff', color: 'var(--fg)', cursor: (product.stocks?.quantity ?? 0) <= 0 ? 'not-allowed' : 'pointer', opacity: (product.stocks?.quantity ?? 0) <= 0 ? 0.5 : 1 }}>
            Transfer
          </button>
          <button onClick={() => setDeleteConfirm(true)}
            style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer' }}>
            Delete
          </button>
        </div>
      </div>

      {/* Print-only barcode label — hidden on screen, shown (and everything
          else hidden) when the browser print dialog is triggered. */}
      {printingBarcode && (
        <>
          <style>{`
            @media print {
              body * { visibility: hidden; }
              .barcode-print-area, .barcode-print-area * { visibility: visible; }
              .barcode-print-area { position: absolute; top: 0; left: 0; }
            }
          `}</style>
          <div className="barcode-print-area" style={{ position: 'fixed', top: -9999, left: -9999 }}>
            <BarcodeLabel skuCode={product.sku_code || product.product_code} productName={product.product_name} />
          </div>
        </>
      )}

      {/* Info Strip */}
      <div style={{ display: 'flex', border: '1px solid var(--border)', background: '#fff' }}>
        {/* Image */}
        <div style={{ width: 160, minHeight: 120, borderRight: '1px solid var(--border)', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, padding: 8 }}>
          {selectedImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={selectedImage} alt={product.product_name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer', color: 'var(--accent)' }}>
              <span style={{ fontSize: 22 }}>+</span>
              <span style={{ fontSize: 11 }}>Upload image</span>
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  if (f) handleQuickImageUpload(f)
                  e.target.value = ''
                }}
              />
            </label>
          )}
        </div>
        {/* Current Stock */}
        <div style={{ flex: 1, padding: '14px 18px', borderRight: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Current Stock</div>
          <div style={{ fontSize: 26, fontWeight: 600, color: 'var(--fg)', marginTop: 4 }}>{stock} <span style={{ fontSize: 12, color: 'var(--muted)' }}>units</span></div>
          {product.unit_cost != null && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
              ₹{Number(product.unit_cost).toLocaleString('en-US', { minimumFractionDigits: 2 })} / unit
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            📍 {product.stocks?.location || 'No location set'}
          </div>
        </div>
        {/* Lending Summary */}
        <div style={{ flex: 1, padding: '14px 18px', borderRight: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Lending Summary</div>
            <select value={lendingPeriod} onChange={e => setLendingPeriod(e.target.value as LendingPeriod)}
              style={{ fontSize: 10, padding: '2px 6px', border: '1px solid var(--border)', background: '#fff', color: 'var(--fg)', cursor: 'pointer' }}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          {summaryLoading ? (
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Loading…</div>
          ) : (
            <div style={{ display: 'flex', gap: 20 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>Total Lent</div>
                <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--fg)', marginTop: 2 }}>{lendingSummary.totalLent}</div>
              </div>
              <div style={{ width: 1, background: 'var(--border)' }} />
              <div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>Returned</div>
                <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--fg)', marginTop: 2 }}>{lendingSummary.returned}</div>
              </div>
            </div>
          )}
        </div>
        {/* Stock Issues */}
        <div style={{ flex: 1, padding: '14px 18px', borderRight: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Stock Issues</div>
          <div style={{ display: 'flex', gap: 20 }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>Damaged</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: damaged > 0 ? '#d97706' : 'var(--fg)', marginTop: 2 }}>{damaged}</div>
            </div>
            <div style={{ width: 1, background: 'var(--border)' }} />
            <div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>Lost</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: lost > 0 ? '#dc2626' : 'var(--fg)', marginTop: 2 }}>{lost}</div>
            </div>
          </div>
        </div>
        {/* Category */}
        <div style={{ flex: 1, padding: '14px 18px' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Category</div>
          {product.category_name ? (
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg)' }}>{product.category_name}</span>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Not set</span>
          )}
        </div>
      </div>

      {/* Transfer History — only shown once this product has actually moved
          between domains, so most products (never transferred) don't carry
          an empty section. */}
      {transferHistory.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid var(--border)' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>
            Transfer History
          </div>
          <div style={{ maxHeight: 160, overflowY: 'auto' }}>
            {transferHistory.map((t) => (
              <div key={t.transfer_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderBottom: '1px solid var(--border)', fontSize: 11 }}>
                <div style={{ color: 'var(--fg)' }}>
                  <strong>{t.quantity}</strong> unit(s): {t.source_domain_name ?? '—'} → {t.destination_domain_name ?? '—'}
                  <span style={{ color: 'var(--muted)', marginLeft: 8 }}>({t.mode})</span>
                </div>
                <div style={{ color: 'var(--muted)', whiteSpace: 'nowrap', marginLeft: 12 }}>
                  {formatDate(t.created_at)}{t.transferred_by_name ? ` · by ${t.transferred_by_name}` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Borrowing History */}
      <div style={{ background: '#fff', border: '1px solid var(--border)', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Borrowing History</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setCurrentPage(1) }} style={selectStyleH}>
              <option value="">All Status</option>
              <option value="PENDING">Pending</option>
              <option value="CONSUMABLE">Consumable</option>
              <option value="RETURNED">Returned</option>
              <option value="DAMAGED">Damaged</option>
              <option value="LOST">Lost</option>
            </select>
            <select value={deptFilter} onChange={e => { setDeptFilter(e.target.value); setCurrentPage(1) }} style={selectStyleH}>
              <option value="">All Departments</option>
              {uniqueDepts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <input type="text" placeholder="Search name, dept, status..." value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1) }}
              style={{ padding: '5px 10px', fontSize: 12, border: '1px solid var(--border)', color: 'var(--fg)', background: '#fff', width: 200, outline: 'none' }} />
            {(statusFilter || deptFilter || searchQuery) && (
              <button onClick={() => { setStatusFilter(''); setDeptFilter(''); setSearchQuery(''); setCurrentPage(1) }}
                style={{ padding: '5px 10px', fontSize: 11, border: '1px solid var(--border)', background: '#fff', color: 'var(--muted)', cursor: 'pointer' }}>Clear</button>
            )}
          </div>
        </div>

        <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface)' }}>
              <tr style={{ background: 'var(--surface)' }}>
                {['S.No', 'Borrower Name', 'Type', 'Department'].map(h => (
                  <th key={h} style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)', textAlign: 'left', whiteSpace: 'nowrap', userSelect: 'none' }}>{h}</th>
                ))}
                <th onClick={() => handleSortH('borrowed')} style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)', textAlign: 'center', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>Borrowed <SortIconH col="borrowed" /></span></th>
                {['Returned', 'Damaged', 'Lost', 'Balance'].map(h => (
                  <th key={h} style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)', textAlign: 'center', whiteSpace: 'nowrap', userSelect: 'none' }}>{h}</th>
                ))}
                <th onClick={() => handleSortH('borrow_date')} style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)', textAlign: 'left', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>Borrow Date <SortIconH col="borrow_date" /></span></th>
                <th onClick={() => handleSortH('return_date')} style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)', textAlign: 'left', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>Return Date <SortIconH col="return_date" /></span></th>
                {['Status'].map(h => (
                  <th key={h} style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)', textAlign: 'left', whiteSpace: 'nowrap', userSelect: 'none' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ padding: '32px 10px', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                    {searchQuery ? 'No records match your search.' : 'No borrowing history found.'}
                  </td>
                </tr>
              ) : (
                pageRows.map((row) => {
                  const FULLY_RETURNED_STATUSES = ['RETURNED', 'RETURNED_DAMAGED', 'RETURNED_LOST']
                  const borrowed = (row.original_quantity != null && row.original_quantity > 0) ? row.original_quantity : row.quantity
                  const dmg = row.damaged_quantity || 0
                  const lst = row.lost_quantity || 0
                  const isFullyReturned = FULLY_RETURNED_STATUSES.includes(row.status)
                  const retd = isFullyReturned ? Math.max(0, borrowed - dmg - lst) : Math.max(0, borrowed - row.quantity - dmg - lst)
                  const bal = isFullyReturned ? 0 : row.quantity
                  return (
                    <tr key={row.lending_order_id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '7px 10px', color: 'var(--muted)' }}>{String(row.sno).padStart(2, '0')}</td>
                      <td style={{ padding: '7px 10px', fontWeight: 500, color: 'var(--fg)', whiteSpace: 'nowrap' }}>{row.borrower_name}</td>
                      <td style={{ padding: '7px 10px' }}>
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', background: row.borrower_type === 'STUDENT' ? '#dbeafe' : '#dcfce7', color: row.borrower_type === 'STUDENT' ? '#1e40af' : '#166534' }}>
                          {row.borrower_type}
                        </span>
                      </td>
                      <td style={{ padding: '7px 10px', color: 'var(--fg)' }}>{row.department}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'center', color: 'var(--fg)' }}>{borrowed}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'center', color: retd > 0 ? '#16a34a' : 'var(--muted)', fontWeight: retd > 0 ? 600 : 400 }}>{retd > 0 ? retd : '—'}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'center', color: dmg > 0 ? '#dc2626' : 'var(--muted)', fontWeight: dmg > 0 ? 600 : 400 }}>{dmg > 0 ? dmg : '—'}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'center', color: lst > 0 ? '#d97706' : 'var(--muted)', fontWeight: lst > 0 ? 600 : 400 }}>{lst > 0 ? lst : '—'}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'center', color: bal > 0 ? '#92400e' : 'var(--muted)', fontWeight: bal > 0 ? 600 : 400 }}>{bal > 0 ? bal : '—'}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--fg)', whiteSpace: 'nowrap' }}>{formatDate(row.borrow_date)}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--fg)', whiteSpace: 'nowrap' }}>
                        {row.return_date ? formatDate(row.return_date) : (row.due_date ? formatDate(row.due_date) : '—')}
                      </td>
                      <td style={{ padding: '7px 10px' }}><LendingStatusDisplay record={row} /></td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {showAll
                ? `Showing all ${filtered.length} records`
                : `Showing ${filtered.length === 0 ? 0 : (currentPage - 1) * ROWS_PER_PAGE + 1}–${Math.min(currentPage * ROWS_PER_PAGE, filtered.length)} of ${filtered.length}`}
            </div>
            <button
              onClick={() => { setShowAll(v => !v); setCurrentPage(1); }}
              style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: '1px solid var(--border)', padding: '2px 8px', cursor: 'pointer' }}
            >
              {showAll ? 'Paginate' : 'Show All'}
            </button>
          </div>
          {!showAll && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}
                style={{ padding: '3px 10px', fontSize: 11, border: '1px solid var(--border)', background: '#fff', color: currentPage === 1 ? 'var(--muted)' : 'var(--fg)', cursor: currentPage === 1 ? 'default' : 'pointer' }}>
                Prev
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const page = totalPages <= 5 ? i + 1 : currentPage <= 3 ? i + 1 : currentPage + i - 2
                if (page < 1 || page > totalPages) return null
                return (
                  <button key={page} onClick={() => setCurrentPage(page)}
                    style={{ padding: '3px 10px', fontSize: 11, border: '1px solid var(--border)', background: currentPage === page ? 'var(--accent)' : '#fff', color: currentPage === page ? '#fff' : 'var(--fg)', cursor: 'pointer', fontWeight: currentPage === page ? 600 : 400 }}>
                    {page}
                  </button>
                )
              })}
              <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}
                style={{ padding: '3px 10px', fontSize: 11, border: '1px solid var(--border)', background: '#fff', color: currentPage === totalPages ? 'var(--muted)' : 'var(--fg)', cursor: currentPage === totalPages ? 'default' : 'pointer' }}>
                Next
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editOpen && product && (
        <EditModal
          product={product}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => {
            setProduct(prev => prev ? { ...prev, ...updated } : updated)
            if (updated.image_url !== undefined) setSelectedImage(updated.image_url)
            setEditOpen(false)
          }}
        />
      )}

      {/* Transfer Modal */}
      {transferOpen && product && (
        <TransferStockModal
          product={{
            product_id: product.product_id,
            product_name: product.product_name,
            quantity: product.stocks?.quantity ?? 0,
            domain_id: product.domain_id,
            domain_name: product.domain_name,
          }}
          onClose={() => setTransferOpen(false)}
          onTransferred={handleTransferred}
        />
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}>
          <div style={{ background: '#fff', border: '1px solid var(--border)', padding: 24, width: 360, maxWidth: '90vw', textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 8 }}>Delete Product?</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
              This will permanently delete <strong style={{ color: 'var(--fg)' }}>{product.product_name}</strong> and all related records. This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => setDeleteConfirm(false)} disabled={deleting}
                style={{ padding: '5px 18px', fontSize: 12, border: '1px solid var(--border)', background: '#fff', color: 'var(--fg)', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleDelete} disabled={deleting}
                style={{ padding: '5px 18px', fontSize: 12, fontWeight: 600, background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', opacity: deleting ? 0.5 : 1 }}>
                {deleting ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
