"use client";
import { authFetch } from "@/contexts/UserContext";
import { uploadFile } from "@/lib/uploadClient";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import ImageCropModal from "@/components/ImageCropModal";
import UploadProductsCsvModal from "@/components/UploadProductsCsvModal";

interface ProductItem {
  id: string;
  productName: string;
  sku: string;
  quantity: number | '';
  cost: number | '';
  lowStockThreshold: number | '';
  returnable: boolean | null;
  imageFile: File | null;
  imagePreview: string | null;
  category_id: string;
}

const createEmptyProductItem = (id: string): ProductItem => ({
  id,
  productName: '',
  sku: '',
  quantity: '',
  cost: '',
  lowStockThreshold: '',
  returnable: null,
  imageFile: null,
  imagePreview: null,
  category_id: '',
});

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUpdateStockModalOpen, setIsUpdateStockModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sortField, setSortField] = useState<'price' | 'stock' | 'threshold' | ''>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [listCurrentPage, setListCurrentPage] = useState(1);
  const [listShowAll, setListShowAll] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  // Categories
  const [categories, setCategories] = useState<{category_id: string; category_name: string}[]>([]);
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [addCategoryLoading, setAddCategoryLoading] = useState(false);
  const [addCategoryForContext, setAddCategoryForContext] = useState<{type: 'modal'|'inline'; itemId: string} | null>(null);

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

  // Update stock form fields
  const [additionalStock, setAdditionalStock] = useState<number | ''>('');
  const [newUnitCost, setNewUnitCost] = useState<number | ''>('');

  const handleApplyCsvItems = (items: ProductItem[]) => {
    setProductItems(items.length > 0 ? items : productItems);
    if (!isModalOpen) setIsModalOpen(true);
  };

  const fetchProducts = useCallback(async () => {
    try {
      const res = await authFetch("/api/products");
      if (res.ok) {
        const data = await res.json();
        setProducts(data || []);
      } else {
        console.error("Failed to fetch products", await res.text());
      }
    } catch (error) {
      console.error("Failed to fetch products", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    async function fetchCategories() {
      try {
        const res = await authFetch('/api/categories');
        if (res.ok) {
          const data = await res.json();
          if (mounted) setCategories(data || []);
        }
      } catch { /* ignore */ }
    }
    fetchProducts();
    fetchCategories();
    return () => { mounted = false };
  }, [fetchProducts]);

  // Helper functions for multi-item management
  const addNewProductItem = () => {
    setProductItems(prev => [...prev, createEmptyProductItem(Date.now().toString())]);
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
  };

  const resetInlineItem = () => {
    setInlineItems([]);
  };

  const addNewInlineItem = () => {
    setInlineItems(prev => [...prev, createEmptyProductItem(`inline-${Date.now()}`)]);
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

  if (loading) return <div style={{ padding: 20, fontSize: 12, color: 'var(--muted)' }}>Loading products…</div>;

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim() || addCategoryLoading) return;
    setAddCategoryLoading(true);
    try {
      const res = await authFetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_name: newCategoryName.trim() }),
      });
      if (res.ok) {
        const created = await res.json();
        setCategories(prev => [...prev, created]);
        if (addCategoryForContext) {
          if (addCategoryForContext.type === 'modal') {
            updateProductItem(addCategoryForContext.itemId, 'category_id', created.category_id);
          } else {
            updateInlineItem(addCategoryForContext.itemId, 'category_id', created.category_id);
          }
        }
        setNewCategoryName('');
        setShowAddCategoryModal(false);
        setAddCategoryForContext(null);
      }
    } catch (err) {
      console.error('Error creating category:', err);
    } finally {
      setAddCategoryLoading(false);
    }
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
      } else if (sortField === 'stock') {
        av = na.stocks?.quantity ?? na.stock ?? na.quantity ?? 0;
        bv = nb.stocks?.quantity ?? nb.stock ?? nb.quantity ?? 0;
      } else {
        av = na.low_stock_threshold ?? 0;
        bv = nb.low_stock_threshold ?? 0;
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }

  const LIST_ROWS_PER_PAGE = 20;
  const listTotalPages = Math.max(1, Math.ceil(filteredProducts.length / LIST_ROWS_PER_PAGE));
  const listStartIdx = (listCurrentPage - 1) * LIST_ROWS_PER_PAGE;
  const listEndIdx = listStartIdx + LIST_ROWS_PER_PAGE;
  const listPageRows = listShowAll ? filteredProducts : filteredProducts.slice(listStartIdx, listEndIdx);

  const handleProductSort = (field: 'price' | 'stock' | 'threshold') => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
    setListCurrentPage(1);
  };

  function ProductSortIcon({ field: f }: { field: 'price' | 'stock' | 'threshold' }) {
    if (sortField !== f) return <span style={{ opacity: 0.3, fontSize: 10, marginLeft: 3 }}>↑</span>;
    return <span style={{ color: 'var(--accent)', fontSize: 10, marginLeft: 3 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  const handleOpenUpdateStock = (product: any) => {
    setSelectedProduct(product);
    setAdditionalStock('');
    setNewUnitCost(product.unit_cost || '');
    setIsUpdateStockModalOpen(true);
  };

  const handleUpdateStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) return;
    setSaving(true);
    try {
      const body: any = {};
      if (additionalStock !== '' && additionalStock !== 0) body.additionalStock = Number(additionalStock);
      if (newUnitCost !== '' && newUnitCost !== selectedProduct.unit_cost) body.unitCost = Number(newUnitCost);
      const productId = selectedProduct.product_id || selectedProduct.id;
      const res = await authFetch(`/api/products/${productId}/update-stock`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { console.error('Failed to update stock', await res.text()); return; }
      const result = await res.json();
      setProducts((prevProducts) => prevProducts.map((p) => (p.product_id || p.id) === productId ? { ...p, ...result.product } : p));
      setIsUpdateStockModalOpen(false);
      setSelectedProduct(null);
    } catch (err) {
      console.error('Error updating stock', err);
    } finally {
      setSaving(false);
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
            <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>No image</div>
          )}
        </div>
        <div style={{ padding: '10px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name ?? 'Unnamed'}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{code ?? '—'}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Stock: <span style={{ color: currentStock <= 0 ? 'var(--danger)' : 'var(--fg)', fontWeight: 600 }}>{currentStock}</span></div>
        </div>
        <div style={{ display: 'flex', borderTop: '1px solid var(--border)' }}>
          <button
            onClick={(e) => { e.stopPropagation(); handleOpenUpdateStock(normalized); }}
            style={{ flex: 1, padding: '7px 0', fontSize: 11, color: 'var(--fg)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Update Stock
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
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 4,
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
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Products</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>All inventory products</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            placeholder="Search products…"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setListCurrentPage(1); }}
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
              style={{ padding: '5px 14px', fontSize: 12, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}
            >
              + Add Product ▾
            </button>
            {showAddMenu && (
              <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, background: '#fff', border: '1px solid var(--border)', boxShadow: '0 6px 18px rgba(0,0,0,0.12)', zIndex: 20, minWidth: 180 }}>
                <button
                  onClick={() => { setShowAddMenu(false); setIsModalOpen(true); }}
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
          onChange={(e) => { setCategoryFilter(e.target.value); setListCurrentPage(1); }}
          style={{ padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', color: 'var(--fg)', background: 'var(--bg)', outline: 'none', cursor: 'pointer' }}
        >
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
        </select>
        {(categoryFilter || sortField) && (
          <button
            onClick={() => { setCategoryFilter(''); setSortField(''); setSortDir('asc'); setListCurrentPage(1); }}
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
                setSaving(true);
                
                try {
                  // Process each product item
                  for (const item of productItems) {
                    const matched = findExistingMatch(item.productName || "");
                    const matchedId = matched?.product_id ?? matched?.id ?? null;

                    // Update existing product if match found
                    if (matchedId) {
                      const updateBody: any = {};
                      if (item.productName) updateBody.product_name = item.productName;
                      if (item.sku) updateBody.serial_number = item.sku;
                      if (item.lowStockThreshold !== '') updateBody.low_stock_threshold = Number(item.lowStockThreshold);
                      if (item.returnable !== null) updateBody.returnable = !!item.returnable;
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
                        }
                      }

                      const additionalStock = item.quantity === '' ? undefined : Number(item.quantity);
                      const unitCost = item.cost === '' ? undefined : Number(item.cost);
                      if (additionalStock !== undefined || unitCost !== undefined) {
                        const stockRes = await authFetch(`/api/products/${matchedId}/update-stock`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ additionalStock, unitCost }),
                        });
                        if (stockRes.ok) {
                          const result = await stockRes.json();
                          setProducts((p) => p.map((prod) => {
                            const pid = prod.product_id || prod.id;
                            return pid === matchedId ? { ...prod, ...result.product } : prod;
                          }));
                        }
                      }
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
                      sku: item.sku || undefined,
                      quantity: item.quantity === '' ? undefined : Number(item.quantity),
                      cost: item.cost === '' ? undefined : Number(item.cost),
                      low_stock_threshold: item.lowStockThreshold === '' ? undefined : Number(item.lowStockThreshold),
                      returnable: item.returnable === null ? undefined : !!item.returnable,
                      image_url: image_url ?? undefined,
                      category_id: item.category_id || undefined,
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
                          quantity: newStock?.quantity ?? (item.quantity === '' ? 0 : Number(item.quantity)) 
                        } 
                      }, ...p]);
                    }
                  }
                  
                  resetProductItems();
                  setIsModalOpen(false);
                } catch (_err) { 
                  console.error('Error adding products:', _err);
                } finally { 
                  setSaving(false); 
                }
              }}
            >
              {/* Header Row */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: '40px 50px 2fr 1.5fr 1fr 1fr 1fr 80px 1.2fr 1.2fr 40px', 
                gap: 8, 
                marginBottom: 8, 
                paddingBottom: 6, 
                borderBottom: '1px solid var(--border)' 
              }}>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>S.no</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Image</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Product Name</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>SKU</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Qty</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Cost</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Threshold</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Type</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Category</div>
                <div></div>
                <div></div>
              </div>

              {/* Product Items */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '50vh', overflowY: 'auto', paddingRight: 4 }}>
                {productItems.map((item, index) => {
                  const matched = findExistingMatch(item.productName || "");
                  const matchedName = matched?.product_name ?? matched?.name ?? null;
                  return (
                  <div key={item.id} style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '40px 50px 2fr 1.5fr 1fr 1fr 1fr 80px 1.2fr 1.2fr 40px', 
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
                        required
                        value={item.productName} 
                        onChange={(e) => updateProductItem(item.id, 'productName', e.target.value)} 
                        style={{ ...inputStyle, padding: '4px 6px', fontSize: 11 }}
                        placeholder="Product name"
                      />
                      {matchedName && (
                        <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 4 }}>
                          Found in inventory: {matchedName}
                        </div>
                      )}
                    </div>

                    {/* SKU */}
                    <input 
                      value={item.sku} 
                      onChange={(e) => updateProductItem(item.id, 'sku', e.target.value)} 
                      style={{ ...inputStyle, padding: '4px 6px', fontSize: 11 }}
                      placeholder="SKU"
                    />

                    {/* Quantity */}
                    <input 
                      type="number" 
                      min={0} 
                      value={item.quantity as any} 
                      onChange={(e) => updateProductItem(item.id, 'quantity', e.target.value === '' ? '' : Number(e.target.value))} 
                      style={{ ...inputStyle, padding: '4px 6px', fontSize: 11 }}
                      placeholder="0"
                    />

                    {/* Cost */}
                    <input 
                      type="number" 
                      step="0.01" 
                      min={0} 
                      value={item.cost as any} 
                      onChange={(e) => updateProductItem(item.id, 'cost', e.target.value === '' ? '' : Number(e.target.value))} 
                      style={{ ...inputStyle, padding: '4px 6px', fontSize: 11 }}
                      placeholder="0.00"
                    />

                    {/* Low Stock Threshold */}
                    <input 
                      type="number" 
                      min={0} 
                      value={item.lowStockThreshold as any} 
                      onChange={(e) => updateProductItem(item.id, 'lowStockThreshold', e.target.value === '' ? '' : Number(e.target.value))} 
                      style={{ ...inputStyle, padding: '4px 6px', fontSize: 11 }}
                      placeholder="0"
                    />

                    {/* Type */}
                    <select
                      value={item.returnable === null ? '' : item.returnable ? 'returnable' : 'consumable'}
                      onChange={(e) => updateProductItem(item.id, 'returnable', e.target.value === '' ? null : e.target.value === 'returnable')}
                      style={{ ...inputStyle, padding: '4px 6px', fontSize: 11 }}
                    >
                      <option value="">Select</option>
                      <option value="returnable">Returnable</option>
                      <option value="consumable">Consumable</option>
                    </select>

                    {/* Category */}
                    <select
                      value={item.category_id}
                      onChange={(e) => {
                        if (e.target.value === '__add_new__') {
                          setAddCategoryForContext({ type: 'modal', itemId: item.id });
                          setShowAddCategoryModal(true);
                        } else {
                          updateProductItem(item.id, 'category_id', e.target.value);
                        }
                      }}
                      style={{ ...inputStyle, padding: '4px 6px', fontSize: 11 }}
                    >
                      <option value="">Category…</option>
                      {categories.map(c => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
                      <option value="__add_new__">╋ Add New Category</option>
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
                    padding: '6px 12px',
                    fontSize: 11,
                    border: '1px dashed var(--border)',
                    background: 'var(--bg)',
                    color: 'var(--fg)',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  Bulk Upload (CSV)
                </button>
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
                  disabled={saving} 
                  style={{ 
                    padding: '5px 14px', 
                    fontSize: 12, 
                    background: 'var(--accent)', 
                    color: '#fff', 
                    border: 'none', 
                    cursor: 'pointer', 
                    fontWeight: 600 
                  }}
                >
                  {saving ? 'Saving…' : `Save ${productItems.length} Product${productItems.length > 1 ? 's' : ''}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Category Mini Modal */}
      {showAddCategoryModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}>
          <div style={{ background: '#fff', border: '1px solid var(--border)', padding: 20, width: 340, boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 14 }}>Add New Category</div>
            <input
              autoFocus
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateCategory()}
              placeholder="Category name…"
              style={{ width: '100%', padding: '6px 8px', fontSize: 12, border: '1px solid var(--border)', color: 'var(--fg)', boxSizing: 'border-box', marginBottom: 14, outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setShowAddCategoryModal(false); setNewCategoryName(''); setAddCategoryForContext(null); }}
                style={{ padding: '5px 14px', fontSize: 12, border: '1px solid var(--border)', background: '#fff', color: 'var(--fg)', cursor: 'pointer' }}
              >Cancel</button>
              <button
                onClick={handleCreateCategory}
                disabled={!newCategoryName.trim() || addCategoryLoading}
                style={{ padding: '5px 14px', fontSize: 12, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, opacity: !newCategoryName.trim() || addCategoryLoading ? 0.5 : 1 }}
              >{addCategoryLoading ? 'Adding…' : 'Add Category'}</button>
            </div>
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

      {/* Update Stock Modal */}
      {isUpdateStockModalOpen && selectedProduct && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}>
          <div style={{ background: '#fff', width: '90%', maxWidth: 400, padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Update Stock</div>
              <button onClick={() => setIsUpdateStockModalOpen(false)} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--muted)', cursor: 'pointer' }}>×</button>
            </div>
            <form onSubmit={handleUpdateStock} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <span style={labelStyle}>Product</span>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{selectedProduct.product_name || selectedProduct.name || 'N/A'}</div>
              </div>
              <div>
                <span style={labelStyle}>Current Stock</span>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{selectedProduct.stocks?.quantity ?? 0} units</div>
              </div>
              <div>
                <label style={labelStyle}>Add Quantity</label>
                <input type="number" min={0} value={additionalStock} onChange={(e) => setAdditionalStock(e.target.value === '' ? '' : Number(e.target.value))} style={inputStyle} placeholder="Quantity to add" />
              </div>
              <div>
                <label style={labelStyle}>Unit Cost</label>
                <input type="number" step="0.01" min={0} value={newUnitCost} onChange={(e) => setNewUnitCost(e.target.value === '' ? '' : Number(e.target.value))} style={inputStyle} />
              </div>
              {additionalStock !== '' && Number(additionalStock) > 0 && (
                <div style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface)', padding: '6px 10px', border: '1px solid var(--border)' }}>
                  New total: <strong>{(selectedProduct.stocks?.quantity ?? 0) + Number(additionalStock)}</strong> units
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button type="button" onClick={() => setIsUpdateStockModalOpen(false)} style={{ padding: '5px 14px', fontSize: 12, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', cursor: 'pointer' }}>Cancel</button>
                <button type="submit" disabled={saving} style={{ padding: '5px 14px', fontSize: 12, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>{saving ? 'Updating…' : 'Update'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Product Grid / List */}
      {viewMode === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginTop: 12 }}>
          {filteredProducts.map((product , idx) => (
            <ProductCard key={product.id ?? idx} product={product} />
          ))}
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
                  <th style={th}>Type</th>
                  <th style={th}>Category</th>
                  <th onClick={() => handleProductSort('stock')} style={{ ...th, width: 80, cursor: 'pointer' }}><span style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>Stock<ProductSortIcon field="stock" /></span></th>
                  <th onClick={() => handleProductSort('price')} style={{ ...th, width: 90, cursor: 'pointer' }}><span style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>Price<ProductSortIcon field="price" /></span></th>
                  <th onClick={() => handleProductSort('threshold')} style={{ ...th, width: 80, cursor: 'pointer' }}><span style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>Threshold<ProductSortIcon field="threshold" /></span></th>
                  <th style={{ ...th, width: 200 }}>Actions</th>
                </tr>
              </thead>
              <tbody >
                {listPageRows.map((product, idx) => {
                  const normalized = (() => {
                    if (!product) return {} as any;
                    const singleKey = Object.keys(product).length === 1 ? Object.keys(product)[0] : null;
                    if (singleKey && (singleKey === 'product' || singleKey === 'data' || singleKey === 'row')) return product[singleKey] ?? product;
                    return product;
                  })();
                  const name = normalized.name || normalized.title || normalized.product_name || normalized.productName || normalized.label || 'Unnamed';
                  const id = normalized.id ?? normalized.product_id ?? idx;
                  const cost = normalized.cost ?? normalized.price ?? normalized.unit_cost ?? '—';
                  const stock = normalized.stocks?.quantity ?? normalized.stock ?? normalized.quantity ?? 0;
                  const image = normalized.image_url || normalized.image || normalized.photo || normalized.imageUrl || null;
                  const returnable = normalized.returnable;
                  const productType = returnable === true ? 'Returnable' : returnable === false ? 'Consumable' : '—';
                  const sku = normalized.sku || normalized.product_code || '—';
                  const threshold = normalized.low_stock_threshold ?? '—';
                  const categoryName = normalized.category_name ?? '—';
                  
                  return (
                    <tr
                      key={id}
                      onClick={() => { const pid = normalized.product_id ?? normalized.id; if (pid) router.push(`/products/${pid}`); }}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                    >
                      <td style={td}>{(listCurrentPage - 1) * 20 + idx + 1}</td>
                      <td style={td}>
                        <div style={{ width: 60, height: 60, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 4 }}>
                          {image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={image} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ fontSize: 9, color: 'var(--muted)' }}>No img</div>
                          )}
                        </div>
                      </td>

                      <td style={{ ...td, fontWeight: 500 }}>{name}</td>
                      <td style={td}>{sku}</td>
                      <td style={td}>{productType}</td>
                      <td style={td}>{categoryName}</td>
                      <td style={td}>{stock}</td>
                      <td style={td}>{cost}</td>
                      <td style={td}>{threshold}</td>
                      <td style={td}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={(e) => { e.stopPropagation(); handleOpenUpdateStock(normalized); }} style={{ padding: '3px 10px', fontSize: 11, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', cursor: 'pointer' }}>Update Stock</button>
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
                    <td style={td}>
                      <input 
                        value={item.sku} 
                        onChange={(e) => updateInlineItem(item.id, 'sku', e.target.value)} 
                        style={{ ...inputStyle, padding: '4px 6px', fontSize: 11, width: '100%' }}
                        placeholder="SKU"
                      />
                    </td>
                    <td style={td}>
                      <select
                        value={item.returnable === null ? '' : item.returnable ? 'returnable' : 'consumable'}
                        onChange={(e) => updateInlineItem(item.id, 'returnable', e.target.value === '' ? null : e.target.value === 'returnable')}
                        style={{ ...inputStyle, padding: '4px 6px', fontSize: 11, width: '100%' }}
                      >
                        <option value="">Select</option>
                        <option value="returnable">Returnable</option>
                        <option value="consumable">Consumable</option>
                      </select>
                    </td>
                    <td style={td}>
                      <select
                        value={item.category_id}
                        onChange={(e) => {
                          if (e.target.value === '__add_new__') {
                            setAddCategoryForContext({ type: 'inline', itemId: item.id });
                            setShowAddCategoryModal(true);
                          } else {
                            updateInlineItem(item.id, 'category_id', e.target.value);
                          }
                        }}
                        style={{ ...inputStyle, padding: '4px 6px', fontSize: 11, width: '100%' }}
                      >
                        <option value="">Category…</option>
                        {categories.map(c => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
                        <option value="__add_new__">╋ Add New Category</option>
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
                      <input 
                        type="number" 
                        min={0} 
                        value={item.lowStockThreshold as any} 
                        onChange={(e) => updateInlineItem(item.id, 'lowStockThreshold', e.target.value === '' ? '' : Number(e.target.value))} 
                        style={{ ...inputStyle, padding: '4px 6px', fontSize: 11, width: '100%' }}
                        placeholder="0"
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
                                if (item.sku) updateBody.serial_number = item.sku;
                                if (item.lowStockThreshold !== '') updateBody.low_stock_threshold = Number(item.lowStockThreshold);
                                if (item.returnable !== null) updateBody.returnable = !!item.returnable;
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
                                  }
                                }

                                const additionalStock = item.quantity === '' ? undefined : Number(item.quantity);
                                const unitCost = item.cost === '' ? undefined : Number(item.cost);
                                if (additionalStock !== undefined || unitCost !== undefined) {
                                  const stockRes = await authFetch(`/api/products/${matchedId}/update-stock`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ additionalStock, unitCost }),
                                  });
                                  if (stockRes.ok) {
                                    const result = await stockRes.json();
                                    setProducts((p) => p.map((prod) => {
                                      const pid = prod.product_id || prod.id;
                                      return pid === matchedId ? { ...prod, ...result.product } : prod;
                                    }));
                                  }
                                }

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
                                sku: item.sku || undefined,
                                quantity: item.quantity === '' ? undefined : Number(item.quantity),
                                cost: item.cost === '' ? undefined : Number(item.cost),
                                low_stock_threshold: item.lowStockThreshold === '' ? undefined : Number(item.lowStockThreshold),
                                returnable: item.returnable === null ? undefined : !!item.returnable,
                                image_url: image_url ?? undefined,
                                category_id: item.category_id || undefined,
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
                                    quantity: newStock?.quantity ?? (item.quantity === '' ? 0 : Number(item.quantity)) 
                                  } 
                                }, ...p]);
                                
                                // Remove this item from inline items
                                removeInlineItem(item.id);
                              }
                            } catch (_err) { 
                              console.error('Error adding product:', _err);
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
                style={{ padding: '5px 12px', fontSize: 11, border: '1px dashed var(--border)', background: 'var(--bg)', color: 'var(--fg)', cursor: 'pointer', fontWeight: 600 }}
              >
                Bulk Upload (CSV)
              </button>
              {filteredProducts.length > 0 && (
                <span>Showing {listShowAll ? filteredProducts.length : `${Math.min(listStartIdx + 1, filteredProducts.length)}–${Math.min(listEndIdx, filteredProducts.length)}`} of {filteredProducts.length}</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => setListShowAll(!listShowAll)}
                style={{ padding: '4px 10px', fontSize: 11, background: listShowAll ? 'var(--accent)' : 'var(--bg)', color: listShowAll ? '#fff' : 'var(--fg)', border: '1px solid var(--border)', cursor: 'pointer' }}
              >
                {listShowAll ? 'Paginate' : 'Show All'}
              </button>
              {!listShowAll && listTotalPages > 1 && (
                <>
                  <button
                    onClick={() => setListCurrentPage(p => Math.max(1, p - 1))}
                    disabled={listCurrentPage === 1}
                    style={{ padding: '4px 8px', fontSize: 11, background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border)', cursor: listCurrentPage === 1 ? 'not-allowed' : 'pointer', opacity: listCurrentPage === 1 ? 0.5 : 1 }}
                  >Prev</button>
                  {Array.from({ length: listTotalPages }, (_, i) => i + 1).map(page => (
                    <button
                      key={page}
                      onClick={() => setListCurrentPage(page)}
                      style={{ padding: '4px 8px', fontSize: 11, background: listCurrentPage === page ? 'var(--accent)' : 'var(--bg)', color: listCurrentPage === page ? '#fff' : 'var(--fg)', border: '1px solid var(--border)', cursor: 'pointer', fontWeight: listCurrentPage === page ? 600 : 400 }}
                    >{page}</button>
                  ))}
                  <button
                    onClick={() => setListCurrentPage(p => Math.min(listTotalPages, p + 1))}
                    disabled={listCurrentPage === listTotalPages}
                    style={{ padding: '4px 8px', fontSize: 11, background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border)', cursor: listCurrentPage === listTotalPages ? 'not-allowed' : 'pointer', opacity: listCurrentPage === listTotalPages ? 0.5 : 1 }}
                  >Next</button>
                </>
              )}
            </div>
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
