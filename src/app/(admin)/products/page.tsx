"use client";
import { authFetch, useUser } from "@/contexts/UserContext";
import { uploadFile } from "@/lib/uploadClient";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import ImageCropModal from "@/components/ImageCropModal";
import UploadProductsCsvModal from "@/components/UploadProductsCsvModal";
import Pagination from "@/components/Pagination";
import { usePagination } from "@/hooks/usePagination";
import { useToast } from "@/components/ui/Toast";

interface ProductItem {
  id: string;
  productName: string;
  description: string;
  quantity: number | '';
  cost: number | '';
  imageFile: File | null;
  imagePreview: string | null;
  category_id: string;
  // Live "what will this SKU be" preview, not sent to the server — the real
  // value is only assigned inside POST /api/products at save time (see
  // GET /api/products/next-sku). Null while unfetched/loading.
  skuPreview: string | null;
  location: string;
}

const createEmptyProductItem = (id: string): ProductItem => ({
  id,
  productName: '',
  description: '',
  quantity: '',
  cost: '',
  imageFile: null,
  imagePreview: null,
  category_id: '',
  skuPreview: null,
  location: '',
});

// Pure preview fetch — no mutation, see GET /api/products/next-sku's
// doc-comment for the concurrency-drift caveat.
async function fetchSkuPreview(categoryId: string): Promise<string | null> {
  try {
    const url = categoryId ? `/api/products/next-sku?category_id=${encodeURIComponent(categoryId)}` : '/api/products/next-sku';
    const res = await authFetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.sku ?? null;
  } catch {
    return null;
  }
}

// A row counts as "touched" once any field differs from a fresh blank row —
// untouched rows are silently skipped on save instead of blocking submit or
// being sent to the API (see the Add Products form's submit handler).
const isProductItemTouched = (item: ProductItem): boolean =>
  item.productName.trim() !== '' ||
  item.description.trim() !== '' ||
  item.quantity !== '' ||
  item.cost !== '' ||
  item.imageFile !== null ||
  item.category_id !== '';

export default function ProductsPage() {
  const router = useRouter();
  const { appUser } = useUser();
  const isAdmin = appUser?.role === "super_admin";
  const { showToast, showConfirm } = useToast();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sortField, setSortField] = useState<'price' | 'stock' | ''>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  // Categories — read-only here; created/edited only from Admin Settings
  const [categories, setCategories] = useState<{category_id: string; category_name: string}[]>([]);

  // Multi-item product addition
  const [productItems, setProductItems] = useState<ProductItem[]>(
    Array.from({ length: 5 }, (_, i) => createEmptyProductItem(String(i + 1)))
  );

  // Image crop modal state
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [showCropModal, setShowCropModal] = useState(false);
  const [currentCropItemId, setCurrentCropItemId] = useState<string | null>(null);

  // Inline add items in list view (array to support multiple inline additions)
  const [inlineItems, setInlineItems] = useState<ProductItem[]>([]);

  const handleApplyCsvItems = (items: Omit<ProductItem, 'skuPreview'>[]) => {
    const withPreview: ProductItem[] = items.map(item => ({ ...item, skuPreview: null }));
    setProductItems(withPreview.length > 0 ? withPreview : productItems);
    if (!isModalOpen) setIsModalOpen(true);
    const uniqueCategoryIds = [...new Set(withPreview.map(item => item.category_id))];
    uniqueCategoryIds.forEach(catId => {
      fetchSkuPreview(catId).then(sku => {
        setProductItems(prev => prev.map(item => item.category_id === catId ? { ...item, skuPreview: sku } : item));
      });
    });
  };

  const fetchProducts = useCallback(async () => {
    try {
      const res = await authFetch("/api/products");
      if (res.ok) {
        const data = await res.json();
        setProducts(data || []);
      } else {
        console.error("Failed to fetch products", await res.text());
        showToast("Couldn't load products. Please refresh and try again.", "error");
      }
    } catch (error) {
      console.error("Failed to fetch products", error);
      showToast("Couldn't load products. Please check your connection and try again.", "error");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let mounted = true;
    async function fetchCategories() {
      try {
        const res = await authFetch('/api/categories');
        if (res.ok) {
          const data = await res.json();
          if (mounted) setCategories(data || []);
        } else {
          console.error('Failed to fetch categories:', res.status);
        }
      } catch (error) {
        console.error('Failed to fetch categories:', error);
      }
    }
    fetchProducts();
    fetchCategories();
    return () => { mounted = false };
  }, [fetchProducts]);

  // Helper functions for multi-item management
  const addNewProductItem = () => {
    const newItem = createEmptyProductItem(Date.now().toString());
    setProductItems(prev => [...prev, newItem]);
    fetchSkuPreview('').then(sku => mergeProductItem(newItem.id, { skuPreview: sku }));
  };

  const removeProductItem = (id: string) => {
    if (productItems.length > 1) {
      setProductItems(prev => prev.filter(item => item.id !== id));
    }
  };

  // Use functional prev => form to avoid stale-closure issues
  const updateProductItem = (id: string, field: keyof ProductItem, value: any) => {
    setProductItems(prev => prev.map(item =>
      item.id === id ? { ...item, [field]: value } : item
    ));
  };

  // Merge multiple fields at once — avoids double-update / stale-closure when
  // two fields (imageFile + imagePreview) must be set in a single render cycle
  const mergeProductItem = (id: string, fields: Partial<ProductItem>) => {
    setProductItems(prev => prev.map(item =>
      item.id === id ? { ...item, ...fields } : item
    ));
  };

  const resetProductItems = () => {
    const defaultItems: ProductItem[] = Array.from({ length: 5 }, (_, i) =>
      createEmptyProductItem(String(i + 1))
    );
    setProductItems(defaultItems);
    fetchSkuPreview('').then(sku => {
      setProductItems(prev => prev.map(item => item.category_id === '' ? { ...item, skuPreview: sku } : item));
    });
  };

  const resetInlineItem = () => {
    setInlineItems([]);
  };

  const addNewInlineItem = () => {
    const newItem = createEmptyProductItem(`inline-${Date.now()}`);
    setInlineItems(prev => [...prev, newItem]);
    fetchSkuPreview('').then(sku => mergeInlineItem(newItem.id, { skuPreview: sku }));
  };

  const removeInlineItem = (id: string) => {
    setInlineItems(prev => prev.filter(item => item.id !== id));
  };

  // Functional form to avoid stale closure
  const updateInlineItem = (id: string, field: keyof ProductItem, value: any) => {
    setInlineItems(prev => prev.map(item =>
      item.id === id ? { ...item, [field]: value } : item
    ));
  };

  const mergeInlineItem = (id: string, fields: Partial<ProductItem>) => {
    setInlineItems(prev => prev.map(item =>
      item.id === id ? { ...item, ...fields } : item
    ));
  };

  // Helper to normalize product data
  const normalizeProduct = (product: any) => {
    if (!product) return {} as any;
    const singleKey = Object.keys(product).length === 1 ? Object.keys(product)[0] : null;
    if (singleKey && (singleKey === 'product' || singleKey === 'data' || singleKey === 'row')) {
      return product[singleKey] ?? product;
    }
    return product;
  };

  const normaliseName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

  const findExistingMatch = (name: string) => {
    if (!name.trim()) return null;
    const n = normaliseName(name);
    const list = products.map(normalizeProduct);
    return (
      list.find((p) => normaliseName(String(p.product_name || p.name || "")) === n) ??
      list.find((p) => {
        const pn = normaliseName(String(p.product_name || p.name || ""));
        return pn.includes(n) || n.includes(pn);
      }) ??
      null
    );
  };

  // Filter and sort products
  let filteredProducts = products.filter((product) => {
    const norm = normalizeProduct(product);
    if (searchQuery) {
      const name = (norm.name || norm.title || norm.product_name || norm.productName || norm.pname || norm.label || '').toLowerCase();
      if (!name.includes(searchQuery.toLowerCase())) return false;
    }
    if (categoryFilter) {
      const catId = norm.category_id ?? '';
      if (catId !== categoryFilter) return false;
    }
    return true;
  });

  if (sortField) {
    filteredProducts = [...filteredProducts].sort((a, b) => {
      const na = normalizeProduct(a);
      const nb = normalizeProduct(b);
      let av: number, bv: number;
      if (sortField === 'price') {
        av = Number(na.cost ?? na.price ?? na.unit_cost ?? 0);
        bv = Number(nb.cost ?? nb.price ?? nb.unit_cost ?? 0);
      } else {
        av = na.stocks?.quantity ?? na.stock ?? na.quantity ?? 0;
        bv = nb.stocks?.quantity ?? nb.stock ?? nb.quantity ?? 0;
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }

  // A touched row must have name/qty/cost filled in before it can be saved;
  // untouched rows are fine as-is (they're skipped on submit, not validated).
  const hasIncompleteProductRow = productItems.some(
    (item) => isProductItemTouched(item) && (!item.productName.trim() || item.quantity === '' || item.cost === '')
  );

  const { page: listPage, setPage: setListPage, totalPages: listTotalPages, pageRows: listRealPageRows, padRows: listPadRows, showAll: listShowAll, setShowAll: setListShowAll, startIdx: listStartIdx, endIdx: listEndIdx } = usePagination(filteredProducts, { pageSize: 50 });

  if (loading) return <div style={{ padding: 20, fontSize: 12, color: 'var(--muted)' }}>Loading products…</div>;

  const handleProductSort = (field: 'price' | 'stock') => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
    setListPage(1);
  };

  function ProductSortIcon({ field: f }: { field: 'price' | 'stock' }) {
    if (sortField !== f) return <span style={{ opacity: 0.3, fontSize: 10, marginLeft: 3 }}>↑</span>;
    return <span style={{ color: 'var(--accent)', fontSize: 10, marginLeft: 3 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  // Restocking now only happens via the Invoice page (Upload Invoice), which
  // links parsed line items to existing products or creates new ones — this
  // just gets the user there.
  const handleAddClick = () => {
    router.push('/billing');
  };

  const openManualEntryModal = () => {
    setIsModalOpen(true);
    fetchSkuPreview('').then(sku => {
      setProductItems(prev => prev.map(item => (item.category_id === '' && item.skuPreview === null) ? { ...item, skuPreview: sku } : item));
    });
  };

  const handleDeleteProduct = async (product: any) => {
    const productId = product.product_id || product.id;
    if (!productId) return;
    const name = product.product_name || product.name || 'this product';
    if (!(await showConfirm(`Delete "${name}"? This action cannot be undone.`))) return;

    setDeletingId(productId);
    try {
      const res = await authFetch(`/api/products/${productId}`, { method: 'DELETE' });
      if (!res.ok) {
        showToast('Failed to delete product', 'error');
        return;
      }
      setProducts((prev) => prev.filter((p) => (p.product_id || p.id) !== productId));
      showToast('Product deleted', 'success');
    } catch (err) {
      console.error('Error deleting product', err);
      showToast('Failed to delete product', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  // Direct upload for the "no image" placeholder affordance on already-saved
  // products (grid card / list row) — no crop step, just attach whatever was
  // selected, matching the "cropping is optional" decision for new products.
  const handleQuickImageUpload = async (productId: string, file: File) => {
    try {
      const image_url = await uploadFile(file, 'products', authFetch);
      const res = await authFetch(`/api/products/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url }),
      });
      if (res.ok) {
        const updated = await res.json();
        setProducts((prev) => prev.map((p) => (p.product_id || p.id) === productId ? { ...p, ...updated } : p));
      } else {
        console.error('Failed to save product image:', res.status);
        showToast("Couldn't save the image. Please try again.", 'error');
      }
    } catch (err) {
      console.error('Error uploading product image:', err);
      showToast("Couldn't upload the image. Please check your connection and try again.", 'error');
    }
  };

  function ProductCard({ product }: { product: any }) {
    const normalized = (() => {
      if (!product) return {};
      const singleKey = Object.keys(product).length === 1 ? Object.keys(product)[0] : null;
      if (singleKey && (singleKey === 'product' || singleKey === 'data' || singleKey === 'row')) return product[singleKey] ?? product;
      return product;
    })();
    const image = normalized.image_url || normalized.image || normalized.photo || normalized.imageUrl || null;
    const name = normalized.name || normalized.title || normalized.product_name || normalized.productName || normalized.pname || normalized.label || null;
    const code = normalized.product_code ?? normalized.productCode ?? null;
    const productId = normalized.product_id ?? normalized.id;
    const currentStock = normalized.stocks?.quantity ?? 0;
    const handleNavigate = () => { if (productId) router.push(`/products/${productId}`); };

    return (
      <div
        onClick={handleNavigate}
        style={{
          background: '#fff',
          border: '1px solid var(--border)',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'box-shadow 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)')}
        onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
      >
        <div style={{ height: 140, background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 8 }}>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={name || 'product'} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <label
              onClick={(e) => e.stopPropagation()}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer', color: 'var(--accent)' }}
            >
              <span style={{ fontSize: 18 }}>+</span>
              <span style={{ fontSize: 10 }}>Upload image</span>
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (f && productId) handleQuickImageUpload(productId, f);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
        <div style={{ padding: '10px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name ?? 'Unnamed'}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{code ?? '—'}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Stock: <span style={{ color: currentStock <= 0 ? 'var(--danger)' : 'var(--fg)', fontWeight: 600 }}>{currentStock}</span></div>
        </div>
        <div style={{ display: 'flex', borderTop: '1px solid var(--border)' }}>
          <button
            onClick={(e) => { e.stopPropagation(); handleAddClick(); }}
            style={{ flex: 1, padding: '7px 0', fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', borderRight: '1px solid var(--border)', cursor: 'pointer', fontWeight: 600 }}
          >
            + Add
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDeleteProduct(normalized); }}
            disabled={deletingId === productId}
            style={{ flex: 1, padding: '7px 0', fontSize: 11, color: 'var(--danger, #dc2626)', background: 'none', border: 'none', cursor: deletingId === productId ? 'not-allowed' : 'pointer', opacity: deletingId === productId ? 0.6 : 1 }}
          >
            {deletingId === productId ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '5px 8px',
    fontSize: 12,
    border: '1px solid var(--border)',
    color: 'var(--fg)',
    background: 'var(--bg)',
    outline: 'none',
    boxSizing: 'border-box',
  };
  const th: React.CSSProperties = {
    padding: '6px 10px',
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 600,
    color: '#0E1323',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    border: '1px solid #d1d1d1',
    whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = {
    padding: '7px 10px',
    fontSize: 12,
    color: 'var(--fg)',
    border: '1px solid #d1d1d1',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Stock List</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>All inventory products</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            placeholder="Search products…"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setListPage(1); }}
            style={{ padding: '5px 10px', fontSize: 12, border: '1px solid var(--border)', color: 'var(--fg)', background: 'var(--bg)', outline: 'none', width: 220 }}
          />
          <div style={{ display: 'flex', border: '1px solid var(--border)' }}>
            <button
              onClick={() => setViewMode('grid')}
              style={{ padding: '5px 10px', fontSize: 11, background: viewMode === 'grid' ? 'var(--fg)' : 'var(--bg)', color: viewMode === 'grid' ? '#fff' : 'var(--muted)', border: 'none', cursor: 'pointer' }}
            >
              Grid
            </button>
            <button
              onClick={() => setViewMode('list')}
              style={{ padding: '5px 10px', fontSize: 11, background: viewMode === 'list' ? 'var(--fg)' : 'var(--bg)', color: viewMode === 'list' ? '#fff' : 'var(--muted)', border: 'none', borderLeft: '1px solid var(--border)', cursor: 'pointer' }}
            >
              List
            </button>
          </div>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowAddMenu((v) => !v)}
              style={{ padding: '10px 22px', fontSize: 14, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700 }}
            >
              + Add Product ▾
            </button>
            {showAddMenu && (
              <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, background: '#fff', border: '1px solid var(--border)', boxShadow: '0 6px 18px rgba(0,0,0,0.12)', zIndex: 20, minWidth: 180 }}>
                <button
                  onClick={() => {
                    setShowAddMenu(false);
                    openManualEntryModal();
                  }}
                  style={{ width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 12, background: '#fff', border: 'none', cursor: 'pointer' }}
                >
                  Manual Entry
                </button>
                <button
                  onClick={() => { setShowAddMenu(false); setShowCsvModal(true); }}
                  style={{ width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 12, background: '#fff', borderTop: '1px solid var(--border)', borderLeft: 'none', borderRight: 'none', borderBottom: 'none', cursor: 'pointer' }}
                >
                  Import from CSV
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filters Row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <select
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setListPage(1); }}
          style={{ padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', color: 'var(--fg)', background: 'var(--bg)', outline: 'none', cursor: 'pointer' }}
        >
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
        </select>
        {(categoryFilter || sortField) && (
          <button
            onClick={() => { setCategoryFilter(''); setSortField(''); setSortDir('asc'); setListPage(1); }}
            style={{ padding: '5px 8px', fontSize: 11, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--muted)', cursor: 'pointer' }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Add Product Modal */}
      {isModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}>
          <div style={{ background: '#fff', width: '95%', maxWidth: 1200, padding: 24, position: 'relative', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Add New Products</div>
              <button onClick={() => { setIsModalOpen(false); resetProductItems(); }} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--muted)', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (hasIncompleteProductRow) return;
                setSaving(true);

                // Only rows the user actually started filling get validated/
                // saved — a row left completely untouched is silently
                // skipped rather than blocking submit or being sent to the API.
                const rowsToSave = productItems.filter(isProductItemTouched);
                const succeededIds: string[] = [];
                const failed: { name: string; message: string }[] = [];

                for (const item of rowsToSave) {
                  // Each row is independent — one row's failure (e.g. a
                  // duplicate name/SKU conflict from the API) must not abort
                  // the rest of the batch or leave the user with no idea
                  // what happened, which is what an uncaught throw here used
                  // to do (the whole loop would stop silently).
                  try {
                    const matched = findExistingMatch(item.productName || "");
                    const matchedId = matched?.product_id ?? matched?.id ?? null;

                    // Update existing product if match found
                    if (matchedId) {
                      const updateBody: any = {};
                      if (item.productName) updateBody.product_name = item.productName;
                      if (item.description) updateBody.description = item.description;
                      if (item.category_id) updateBody.category_id = item.category_id;

                      if (Object.keys(updateBody).length > 0) {
                        const updRes = await authFetch(`/api/products/${matchedId}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(updateBody),
                        });
                        if (updRes.ok) {
                          const updated = await updRes.json();
                          setProducts((p) => p.map((prod) => {
                            const pid = prod.product_id || prod.id;
                            return pid === matchedId ? { ...prod, ...updated } : prod;
                          }));
                        } else {
                          const errData = await updRes.json().catch(() => null);
                          throw new Error(errData?.error || `Failed to update "${item.productName}"`);
                        }
                      }

                      const additionalStock = item.quantity === '' ? undefined : Number(item.quantity);
                      const unitCost = item.cost === '' ? undefined : Number(item.cost);
                      const itemLocation = item.location.trim() ? item.location.trim() : undefined;
                      if (additionalStock !== undefined || unitCost !== undefined || itemLocation !== undefined) {
                        const stockRes = await authFetch(`/api/products/${matchedId}/update-stock`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ additionalStock, unitCost, ...(itemLocation !== undefined ? { location: itemLocation } : {}) }),
                        });
                        if (stockRes.ok) {
                          const result = await stockRes.json();
                          setProducts((p) => p.map((prod) => {
                            const pid = prod.product_id || prod.id;
                            return pid === matchedId ? { ...prod, ...result.product } : prod;
                          }));
                        } else {
                          const errData = await stockRes.json().catch(() => null);
                          throw new Error(errData?.error || `Failed to update stock for "${item.productName}"`);
                        }
                      }
                      succeededIds.push(item.id);
                      continue;
                    }

                    let image_url: string | undefined = undefined;

                    // Upload image if exists
                    if (item.imageFile) {
                      try {
                        image_url = await uploadFile(item.imageFile, 'products', authFetch);
                      } catch (uploadErr) {
                        console.error('Image upload error:', uploadErr);
                        // Fallback: if upload failed, use the local data URL preview so UI shows the image.
                        if (item.imagePreview) {
                          console.warn('[upload] falling back to data URL for product image (not persisted to storage)');
                          image_url = item.imagePreview;
                        }
                      }
                    }

                    const body: any = {
                      name: item.productName || undefined,
                      description: item.description || undefined,
                      quantity: item.quantity === '' ? undefined : Number(item.quantity),
                      cost: item.cost === '' ? undefined : Number(item.cost),
                      image_url: image_url ?? undefined,
                      category_id: item.category_id || undefined,
                      location: item.location.trim() || undefined,
                    };

                    const res = await authFetch('/api/products', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(body)
                    });

                    if (res.ok) {
                      const created = await res.json();
                      const newProduct = created.product || created;
                      const newStock = created.stock;
                      setProducts((p) => [{
                        ...newProduct,
                        stocks: {
                          quantity: newStock?.quantity ?? (item.quantity === '' ? 0 : Number(item.quantity)),
                          location: newStock?.location ?? (item.location.trim() || null),
                        }
                      }, ...p]);
                      succeededIds.push(item.id);
                    } else {
                      const errData = await res.json().catch(() => null);
                      throw new Error(errData?.error || `Failed to create "${item.productName || 'product'}"`);
                    }
                  } catch (itemErr) {
                    console.error('Error saving product row:', itemErr);
                    failed.push({
                      name: item.productName || 'Unnamed row',
                      message: itemErr instanceof Error ? itemErr.message : 'Unexpected error',
                    });
                  }
                }

                if (failed.length === 0) {
                  resetProductItems();
                  setIsModalOpen(false);
                  if (succeededIds.length > 0) showToast(`${succeededIds.length} product(s) saved`, 'success');
                } else {
                  // Leave the modal open with only the failed rows still
                  // filled in, so the user can fix and resubmit instead of
                  // retyping everything from scratch.
                  setProductItems((prev) => {
                    const remaining = prev.filter((p) => !succeededIds.includes(p.id));
                    return remaining.length > 0 ? remaining : [createEmptyProductItem(Date.now().toString())];
                  });
                  const summary = failed.map((f) => `${f.name}: ${f.message}`).join(' · ');
                  showToast(
                    `${succeededIds.length > 0 ? `${succeededIds.length} saved, ` : ''}${failed.length} failed — ${summary}`,
                    'error'
                  );
                }
                setSaving(false);
              }}
            >
              {/* Header Row */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '40px 50px 2fr 1.5fr 1fr 1fr 90px 80px 1.2fr 1.2fr 40px',
                gap: 8,
                marginBottom: 8,
                paddingBottom: 6,
                borderBottom: '1px solid var(--border)'
              }}>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>S.no</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Image</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Product Name</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Description</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Qty</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Cost</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Location</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>SKU</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Category</div>
                <div></div>
                <div></div>
              </div>

              {/* Product Items */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '50vh', overflowY: 'auto', paddingRight: 4 }}>
                {productItems.map((item, index) => {
                  const matched = findExistingMatch(item.productName || "");
                  const matchedName = matched?.product_name ?? matched?.name ?? null;
                  const touched = isProductItemTouched(item);
                  const incomplete = touched && (!item.productName.trim() || item.quantity === '' || item.cost === '');
                  return (
                  <div key={item.id} style={{
                    display: 'grid',
                    gridTemplateColumns: '40px 50px 2fr 1.5fr 1fr 1fr 90px 80px 1.2fr 1.2fr 40px',
                    gap: 8,
                    alignItems: 'start',
                    padding: '8px 4px',
                    background: index % 2 === 0 ? '#fff' : 'var(--surface)',
                    borderRadius: 2
                  }}>
                    {/* Index */}
                    <div style={{ fontSize: 11, color: 'var(--muted)', paddingTop: 5 }}>{index + 1}</div>
                    
                    {/* Image */}
                    <div>
                      <label style={{ 
                        display: 'block', 
                        width: 40, 
                        height: 40, 
                        border: '1px dashed var(--border)', 
                        cursor: 'pointer',
                        overflow: 'hidden',
                        position: 'relative'
                      }}>
                        {item.imagePreview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.imagePreview} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="preview" />
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 18, color: 'var(--muted)' }}>+</div>
                        )}
                        <input 
                          type="file" 
                          accept="image/*" 
                          style={{ display: 'none' }} 
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            if (f) {
                              const fr = new FileReader();
                              fr.onload = () => {
                                if (typeof fr.result === 'string') {
                                  setCropSrc(fr.result);
                                  setCurrentCropItemId(item.id);
                                  setShowCropModal(true);
                                }
                              };
                              fr.readAsDataURL(f);
                            }
                            e.target.value = '';
                          }} 
                        />
                      </label>
                    </div>

                    {/* Product Name */}
                    <div>
                      <input
                        value={item.productName}
                        onChange={(e) => updateProductItem(item.id, 'productName', e.target.value)}
                        style={{ ...inputStyle, padding: '4px 6px', fontSize: 11, borderColor: incomplete && !item.productName.trim() ? 'var(--danger)' : undefined }}
                        placeholder="Product name"
                      />
                      {matchedName && (
                        <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 4 }}>
                          Found in inventory: {matchedName}
                        </div>
                      )}
                      {incomplete && (
                        <div style={{ fontSize: 10, color: 'var(--danger)', marginTop: 4 }}>
                          Fill in name, qty, and cost to save this row (or clear it to skip)
                        </div>
                      )}
                    </div>

                    {/* Description (optional) */}
                    <input
                      value={item.description}
                      onChange={(e) => updateProductItem(item.id, 'description', e.target.value)}
                      style={{ ...inputStyle, padding: '4px 6px', fontSize: 11 }}
                      placeholder="Description (optional)"
                    />

                    {/* Quantity */}
                    <input
                      type="number"
                      min={0}
                      value={item.quantity as any}
                      onChange={(e) => updateProductItem(item.id, 'quantity', e.target.value === '' ? '' : Number(e.target.value))}
                      style={{ ...inputStyle, padding: '4px 6px', fontSize: 11, borderColor: incomplete && item.quantity === '' ? 'var(--danger)' : undefined }}
                      placeholder="0"
                    />

                    {/* Cost */}
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={item.cost as any}
                      onChange={(e) => updateProductItem(item.id, 'cost', e.target.value === '' ? '' : Number(e.target.value))}
                      style={{ ...inputStyle, padding: '4px 6px', fontSize: 11, borderColor: incomplete && item.cost === '' ? 'var(--danger)' : undefined }}
                      placeholder="0.00"
                    />

                    {/* Location/Rack (optional) */}
                    <input
                      value={item.location}
                      onChange={(e) => updateProductItem(item.id, 'location', e.target.value)}
                      style={{ ...inputStyle, padding: '4px 6px', fontSize: 11 }}
                      placeholder="e.g. R2"
                    />

                    {/* SKU (auto-generated, preview only) */}
                    <div style={{ padding: '5px 6px', fontSize: 11, color: 'var(--muted)', fontStyle: 'italic', fontFamily: 'monospace' }}>
                      {item.skuPreview ?? '…'}
                    </div>

                    {/* Category */}
                    <select
                      value={item.category_id}
                      onChange={(e) => {
                        const newCategoryId = e.target.value;
                        updateProductItem(item.id, 'category_id', newCategoryId);
                        mergeProductItem(item.id, { skuPreview: null });
                        fetchSkuPreview(newCategoryId).then(sku => mergeProductItem(item.id, { skuPreview: sku }));
                      }}
                      style={{ ...inputStyle, padding: '4px 6px', fontSize: 11 }}
                    >
                      <option value="">Category…</option>
                      {categories.map(c => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
                    </select>

                    {/* Re-crop button (if image exists) */}
                    <div>
                      {item.imagePreview && (
                        <button 
                          type="button" 
                          onClick={() => { 
                            setCropSrc(item.imagePreview); 
                            setCurrentCropItemId(item.id);
                            setShowCropModal(true); 
                          }} 
                          style={{ 
                            fontSize: 9, 
                            color: 'var(--accent)', 
                            background: 'none', 
                            border: '1px solid var(--border)', 
                            padding: '3px 6px', 
                            cursor: 'pointer',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          Re-crop
                        </button>
                      )}
                    </div>

                    {/* Remove button */}
                    <div>
                      {productItems.length > 1 && (
                        <button 
                          type="button" 
                          onClick={() => removeProductItem(item.id)} 
                          style={{ 
                            background: 'none', 
                            border: 'none', 
                            fontSize: 16, 
                            color: 'var(--danger)', 
                            cursor: 'pointer',
                            padding: 0,
                            width: '100%',
                            height: 32,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                          title="Remove item"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>

              {/* Add Item Button */}
              <div style={{ marginTop: 12 }}>
                <button 
                  type="button" 
                  onClick={addNewProductItem} 
                  style={{ 
                    padding: '6px 12px', 
                    fontSize: 11, 
                    border: '1px dashed var(--border)', 
                    background: 'var(--bg)', 
                    color: 'var(--accent)', 
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  + Add Item
                </button>
                <button
                  type="button"
                  onClick={() => setShowCsvModal(true)}
                  style={{
                    marginLeft: 8,
                    padding: '6px 14px',
                    fontSize: 11,
                    border: 'none',
                    background: 'var(--fg)',
                    color: '#fff',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  Bulk Upload (CSV)
                </button>
                <a
                  href="/templates/products-sample.csv"
                  download
                  style={{ marginLeft: 10, fontSize: 11, color: 'var(--accent)', textDecoration: 'underline' }}
                >
                  Download sample CSV
                </a>
              </div>

              {/* Form Actions */}
              <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <button 
                  type="button" 
                  onClick={() => { setIsModalOpen(false); resetProductItems(); }} 
                  style={{ 
                    padding: '5px 14px', 
                    fontSize: 12, 
                    border: '1px solid var(--border)', 
                    background: 'var(--bg)', 
                    color: 'var(--fg)', 
                    cursor: 'pointer' 
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || hasIncompleteProductRow}
                  style={{
                    padding: '5px 14px',
                    fontSize: 12,
                    background: 'var(--accent)',
                    color: '#fff',
                    border: 'none',
                    cursor: saving || hasIncompleteProductRow ? 'not-allowed' : 'pointer',
                    opacity: hasIncompleteProductRow ? 0.6 : 1,
                    fontWeight: 600
                  }}
                >
                  {saving
                    ? 'Saving…'
                    : (() => {
                        const n = productItems.filter(isProductItemTouched).length;
                        return n > 0 ? `Save ${n} Product${n > 1 ? 's' : ''}` : 'Save';
                      })()}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Image Crop Modal */}
      {showCropModal && cropSrc && (
        <ImageCropModal
          imageSrc={cropSrc}
          aspect={1}
          onCrop={(dataUrl, file) => {
            // Merge both fields in ONE state update — two separate calls would
            // cause the second to see stale state and silently drop imageFile
            if (currentCropItemId?.startsWith('inline-')) {
              mergeInlineItem(currentCropItemId, { imageFile: file, imagePreview: dataUrl });
            } else if (currentCropItemId) {
              mergeProductItem(currentCropItemId, { imageFile: file, imagePreview: dataUrl });
            }
            setShowCropModal(false);
            setCropSrc(null);
            setCurrentCropItemId(null);
          }}
          onClose={() => {
            setShowCropModal(false);
            setCropSrc(null);
            setCurrentCropItemId(null);
          }}
        />
      )}

      {/* Product Grid / List */}
      {products.length === 0 ? (
        <div style={{ display: 'flex', flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center', marginTop: 12, border: '1px solid var(--border)', background: '#fff' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: 40 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)' }}>Add your first stock</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', maxWidth: 280 }}>
              Your inventory is empty. Add a product manually to get started.
            </div>
            <button
              onClick={openManualEntryModal}
              aria-label="Add product"
              style={{
                width: 48, height: 48, borderRadius: '50%', background: 'var(--accent)', color: '#fff',
                border: 'none', fontSize: 26, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
              }}
            >
              +
            </button>
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {listRealPageRows.map((product: any, idx: number) => (
              <ProductCard key={product.id ?? idx} product={product} />
            ))}
          </div>
          {filteredProducts.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', background: 'var(--surface)', padding: '8px 12px', borderTop: '1px solid var(--border)', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              <span>Showing {listShowAll ? filteredProducts.length : `${Math.min(listStartIdx + 1, filteredProducts.length)}–${Math.min(listEndIdx, filteredProducts.length)}`} of {filteredProducts.length}</span>
              <Pagination page={listPage} totalPages={listTotalPages} onPageChange={setListPage} showAll={listShowAll} onToggleShowAll={setListShowAll} />
            </div>
          )}
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, marginTop: 12 }}>
          <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1, minHeight: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface)' }}>
                <tr style={{ background: 'var(--surface)' }}>
                  <th style={{ ...th, width: 40 }}>S.no</th>
                  <th style={{ ...th, width: 80 }}>Image</th>
                  <th style={th}>Product Name</th>
                  <th style={th}>SKU</th>
                  <th style={th}>Category</th>
                  <th onClick={() => handleProductSort('stock')} style={{ ...th, width: 80, cursor: 'pointer' }}><span style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>Stock<ProductSortIcon field="stock" /></span></th>
                  <th style={{ ...th, width: 90 }}>Location</th>
                  {isAdmin && <th style={{ ...th, width: 130 }}>Owner</th>}
                  {isAdmin && <th style={{ ...th, width: 130 }}>Domain</th>}
                  <th onClick={() => handleProductSort('price')} style={{ ...th, width: 90, cursor: 'pointer' }}><span style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>Price<ProductSortIcon field="price" /></span></th>
                  <th style={{ ...th, width: 200 }}>Actions</th>
                </tr>
              </thead>
              <tbody >
                {listPadRows.map((product, idx) => {
                  if (!product) {
                    return (
                      <tr key={`empty-${idx}`}>
                        <td style={{ ...td, border: 'none' }} colSpan={isAdmin ? 11 : 9}>&nbsp;</td>
                      </tr>
                    );
                  }
                  const normalized = (() => {
                    const singleKey = Object.keys(product).length === 1 ? Object.keys(product)[0] : null;
                    if (singleKey && (singleKey === 'product' || singleKey === 'data' || singleKey === 'row')) return (product as any)[singleKey] ?? product;
                    return product;
                  })() as any;
                  const name = normalized.name || normalized.title || normalized.product_name || normalized.productName || normalized.label || 'Unnamed';
                  const id = normalized.id ?? normalized.product_id ?? idx;
                  const cost = normalized.cost ?? normalized.price ?? normalized.unit_cost ?? '—';
                  const stock = normalized.stocks?.quantity ?? normalized.stock ?? normalized.quantity ?? 0;
                  const location = normalized.stocks?.location || '—';
                  const ownerName = normalized.owner_name || '—';
                  const domainName = normalized.domain_name || '—';
                  const image = normalized.image_url || normalized.image || normalized.photo || normalized.imageUrl || null;
                  const sku = normalized.sku_code || normalized.product_code || '—';
                  const categoryName = normalized.category_name ?? '—';
                  const rowProductId = normalized.product_id ?? normalized.id;

                  return (
                    <tr
                      key={id}
                      onClick={() => { const pid = normalized.product_id ?? normalized.id; if (pid) router.push(`/products/${pid}`); }}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                    >
                      <td style={td}>{listStartIdx + idx + 1}</td>
                      <td style={td}>
                        <div style={{ width: 60, height: 60, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 4 }}>
                          {image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={image} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <label
                              onClick={(e) => e.stopPropagation()}
                              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', color: 'var(--accent)' }}
                            >
                              <span style={{ fontSize: 14 }}>+</span>
                              <span style={{ fontSize: 8 }}>Upload</span>
                              <input
                                type="file"
                                accept="image/*"
                                style={{ display: 'none' }}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  const f = e.target.files?.[0] ?? null;
                                  if (f && rowProductId) handleQuickImageUpload(rowProductId, f);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                          )}
                        </div>
                      </td>

                      <td style={{ ...td, fontWeight: 500 }}>{name}</td>
                      <td style={td}>{sku}</td>
                      <td style={td}>{categoryName}</td>
                      <td style={td}>{stock}</td>
                      <td style={td}>{location}</td>
                      {isAdmin && <td style={td}>{ownerName}</td>}
                      {isAdmin && <td style={td}>{domainName}</td>}
                      <td style={td}>{cost}</td>
                      <td style={td}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={(e) => { e.stopPropagation(); handleAddClick(); }} style={{ padding: '3px 10px', fontSize: 11, border: '1px solid var(--accent)', background: 'var(--bg)', color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}>+ Add</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteProduct(normalized); }}
                            disabled={deletingId === rowProductId}
                            style={{ padding: '3px 10px', fontSize: 11, border: '1px solid var(--danger, #dc2626)', background: 'var(--bg)', color: 'var(--danger, #dc2626)', cursor: deletingId === rowProductId ? 'not-allowed' : 'pointer', opacity: deletingId === rowProductId ? 0.6 : 1 }}
                          >
                            {deletingId === rowProductId ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {/* Inline Add Item Rows */}
                {inlineItems.map((item, idx) => (
                  <tr key={item.id} style={{ background: idx % 2 === 0 ? 'var(--surface)' : '#fffef5' }}>
                    <td style={td}>{idx + 1}</td>
                    <td style={td}>
                      <label style={{ 
                        display: 'block', 
                        width: 60, 
                        height: 60, 
                        border: '1px dashed var(--border)', 
                        cursor: 'pointer',
                        overflow: 'hidden',
                        position: 'relative',
                        borderRadius: 4
                      }}>
                        {item.imagePreview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.imagePreview} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="preview" />
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 20, color: 'var(--muted)' }}>+</div>
                        )}
                        <input 
                          type="file" 
                          accept="image/*" 
                          style={{ display: 'none' }} 
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            if (f) {
                              const fr = new FileReader();
                              fr.onload = () => {
                                if (typeof fr.result === 'string') {
                                  setCropSrc(fr.result);
                                  setCurrentCropItemId(item.id);
                                  setShowCropModal(true);
                                }
                              };
                              fr.readAsDataURL(f);
                            }
                            e.target.value = '';
                          }} 
                        />
                      </label>
                    </td>
                    <td style={td}>
                      <div>
                        <input 
                          value={item.productName} 
                          onChange={(e) => updateInlineItem(item.id, 'productName', e.target.value)} 
                          style={{ ...inputStyle, padding: '4px 6px', fontSize: 11, width: '100%' }}
                          placeholder="Product name"
                          autoFocus
                        />
                        {(() => {
                          const matched = findExistingMatch(item.productName || "");
                          const matchedName = matched?.product_name ?? matched?.name ?? null;
                          if (!matchedName) return null;
                          return (
                            <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 4 }}>
                              Found in inventory: {matchedName}
                            </div>
                          );
                        })()}
                      </div>
                    </td>
                    <td style={{ ...td, color: 'var(--muted)', fontStyle: 'italic', fontFamily: 'monospace' }}>{item.skuPreview ?? '…'}</td>
                    <td style={td}>
                      <select
                        value={item.category_id}
                        onChange={(e) => {
                          const newCategoryId = e.target.value;
                          updateInlineItem(item.id, 'category_id', newCategoryId);
                          mergeInlineItem(item.id, { skuPreview: null });
                          fetchSkuPreview(newCategoryId).then(sku => mergeInlineItem(item.id, { skuPreview: sku }));
                        }}
                        style={{ ...inputStyle, padding: '4px 6px', fontSize: 11, width: '100%' }}
                      >
                        <option value="">Category…</option>
                        {categories.map(c => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
                      </select>
                    </td>
                    <td style={td}>
                      <input
                        type="number"
                        min={0}
                        value={item.quantity as any}
                        onChange={(e) => updateInlineItem(item.id, 'quantity', e.target.value === '' ? '' : Number(e.target.value))}
                        style={{ ...inputStyle, padding: '4px 6px', fontSize: 11, width: '100%' }}
                        placeholder="0"
                      />
                    </td>
                    <td style={td}>
                      <input
                        value={item.location}
                        onChange={(e) => updateInlineItem(item.id, 'location', e.target.value)}
                        style={{ ...inputStyle, padding: '4px 6px', fontSize: 11, width: '100%' }}
                        placeholder="e.g. R2"
                      />
                    </td>
                    {isAdmin && <td style={{ ...td, color: 'var(--muted)' }}>{appUser?.full_name ?? '—'}</td>}
                    {isAdmin && <td style={{ ...td, color: 'var(--muted)' }}>{appUser?.domain?.domain_name ?? '—'}</td>}
                    <td style={td}>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={item.cost as any}
                        onChange={(e) => updateInlineItem(item.id, 'cost', e.target.value === '' ? '' : Number(e.target.value))}
                        style={{ ...inputStyle, padding: '4px 6px', fontSize: 11, width: '100%' }}
                        placeholder="0.00"
                      />
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button 
                          onClick={async () => {
                            if (!item.productName) return;
                            setSaving(true);
                            
                            try {
                              const matched = findExistingMatch(item.productName || "");
                              const matchedId = matched?.product_id ?? matched?.id ?? null;
                              if (matchedId) {
                                const updateBody: any = {};
                                if (item.productName) updateBody.product_name = item.productName;
                                if (item.description) updateBody.description = item.description;
                                if (item.category_id) updateBody.category_id = item.category_id;

                                if (Object.keys(updateBody).length > 0) {
                                  const updRes = await authFetch(`/api/products/${matchedId}`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(updateBody),
                                  });
                                  if (updRes.ok) {
                                    const updated = await updRes.json();
                                    setProducts((p) => p.map((prod) => {
                                      const pid = prod.product_id || prod.id;
                                      return pid === matchedId ? { ...prod, ...updated } : prod;
                                    }));
                                  } else {
                                    const errData = await updRes.json().catch(() => null);
                                    throw new Error(errData?.error || `Failed to update "${item.productName}"`);
                                  }
                                }

                                const additionalStock = item.quantity === '' ? undefined : Number(item.quantity);
                                const unitCost = item.cost === '' ? undefined : Number(item.cost);
                                const itemLocation = item.location.trim() ? item.location.trim() : undefined;
                                if (additionalStock !== undefined || unitCost !== undefined || itemLocation !== undefined) {
                                  const stockRes = await authFetch(`/api/products/${matchedId}/update-stock`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ additionalStock, unitCost, ...(itemLocation !== undefined ? { location: itemLocation } : {}) }),
                                  });
                                  if (stockRes.ok) {
                                    const result = await stockRes.json();
                                    setProducts((p) => p.map((prod) => {
                                      const pid = prod.product_id || prod.id;
                                      return pid === matchedId ? { ...prod, ...result.product } : prod;
                                    }));
                                  } else {
                                    const errData = await stockRes.json().catch(() => null);
                                    throw new Error(errData?.error || `Failed to update stock for "${item.productName}"`);
                                  }
                                }

                                showToast(`"${item.productName}" saved`, 'success');
                                removeInlineItem(item.id);
                                return;
                              }

                              let image_url: string | undefined = undefined;
                              
                              if (item.imageFile) {
                                try {
                                  image_url = await uploadFile(item.imageFile, 'products', authFetch);
                                } catch (uploadErr) {
                                  console.error('Image upload error:', uploadErr);
                                  // Fallback to local data URL preview if upload to storage failed
                                  if (item.imagePreview) {
                                    console.warn('[upload] falling back to data URL for inline product image (not persisted to storage)');
                                    image_url = item.imagePreview;
                                  }
                                }
                              }

                              const body: any = {
                                name: item.productName || undefined,
                                description: item.description || undefined,
                                quantity: item.quantity === '' ? undefined : Number(item.quantity),
                                cost: item.cost === '' ? undefined : Number(item.cost),
                                image_url: image_url ?? undefined,
                                category_id: item.category_id || undefined,
                                location: item.location.trim() || undefined,
                              };

                              const res = await authFetch('/api/products', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(body)
                              });

                              if (res.ok) {
                                const created = await res.json();
                                const newProduct = created.product || created;
                                const newStock = created.stock;
                                setProducts((p) => [{
                                  ...newProduct,
                                  stocks: {
                                    quantity: newStock?.quantity ?? (item.quantity === '' ? 0 : Number(item.quantity)),
                                    location: newStock?.location ?? (item.location.trim() || null),
                                  }
                                }, ...p]);
                                showToast(`"${item.productName}" saved`, 'success');

                                // Remove this item from inline items
                                removeInlineItem(item.id);
                              } else {
                                const errData = await res.json().catch(() => null);
                                throw new Error(errData?.error || `Failed to create "${item.productName || 'product'}"`);
                              }
                            } catch (err) {
                              console.error('Error adding product:', err);
                              showToast(err instanceof Error ? err.message : 'Failed to save product', 'error');
                            } finally {
                              setSaving(false); 
                            }
                          }} 
                          disabled={saving || !item.productName}
                          style={{ 
                            padding: '3px 10px', 
                            fontSize: 11, 
                            background: 'var(--accent)', 
                            color: '#fff', 
                            border: 'none', 
                            cursor: 'pointer',
                            fontWeight: 600,
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button 
                          onClick={() => removeInlineItem(item.id)} 
                          style={{ 
                            padding: '3px 10px', 
                            fontSize: 11, 
                            border: '1px solid var(--border)', 
                            background: 'var(--bg)', 
                            color: 'var(--fg)', 
                            cursor: 'pointer',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Bottom bar: Add Item + Pagination */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', background: 'var(--surface)', padding: '8px 12px', borderTop: '1px solid var(--border)', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={addNewInlineItem}
                style={{ padding: '5px 12px', fontSize: 11, border: '1px dashed var(--border)', background: 'var(--bg)', color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}
              >
                + Add Item
              </button>
              <button
                onClick={() => setShowCsvModal(true)}
                style={{ padding: '5px 14px', fontSize: 11, border: 'none', background: 'var(--fg)', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
              >
                Bulk Upload (CSV)
              </button>
              <a
                href="/templates/products-sample.csv"
                download
                style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'underline' }}
              >
                Download sample CSV
              </a>
              {filteredProducts.length > 0 && (
                <span>Showing {listShowAll ? filteredProducts.length : `${Math.min(listStartIdx + 1, filteredProducts.length)}–${Math.min(listEndIdx, filteredProducts.length)}`} of {filteredProducts.length}</span>
              )}
            </div>
            <Pagination page={listPage} totalPages={listTotalPages} onPageChange={setListPage} showAll={listShowAll} onToggleShowAll={setListShowAll} />
          </div>
          {showCsvModal && (
            <UploadProductsCsvModal
              onClose={() => setShowCsvModal(false)}
              onApply={(items) => {
                handleApplyCsvItems(items);
                setShowCsvModal(false);
              }}
              categories={categories}
            />
          )}
        </div>
      )}
    </div>
  );
}
