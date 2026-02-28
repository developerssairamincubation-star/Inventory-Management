"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUpdateStockModalOpen, setIsUpdateStockModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  // form fields
  const [productName, setProductName] = useState('');
  const [sku, setSku] = useState('');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [cost, setCost] = useState<number | ''>('');
  const [lowStockThreshold, setLowStockThreshold] = useState<number | ''>('');
  const [returnable, setReturnable] = useState<boolean | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // Update stock form fields
  const [additionalStock, setAdditionalStock] = useState<number | ''>('');
  const [newUnitCost, setNewUnitCost] = useState<number | ''>('');

  useEffect(() => {
    let mounted = true;
    async function fetchProducts() {
      try {
        const res = await fetch("/api/products");
        if (res.ok) {
          const data = await res.json();
          if (mounted) setProducts(data || []);
        } else {
          console.error("Failed to fetch products", await res.text());
        }
      } catch (error) {
        console.error("Failed to fetch products", error);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    fetchProducts();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) return <div style={{ padding: 20, fontSize: 12, color: 'var(--muted)' }}>Loading products…</div>;

  // Filter products based on search query
  const filteredProducts = products.filter((product) => {
    if (!searchQuery) return true;
    const normalized = (() => {
      if (!product) return {};
      const singleKey = Object.keys(product).length === 1 ? Object.keys(product)[0] : null;
      if (singleKey && (singleKey === 'product' || singleKey === 'data' || singleKey === 'row')) {
        return product[singleKey] ?? product;
      }
      return product;
    })();
    const name = (normalized.name || normalized.title || normalized.product_name || normalized.productName || normalized.pname || normalized.label || '').toLowerCase();
    return name.includes(searchQuery.toLowerCase());
  });

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
      const res = await fetch(`/api/products/${productId}/update-stock`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { console.error('Failed to update stock', await res.text()); return; }
      const result = await res.json();
      setProducts((prevProducts) => prevProducts.map((p) => (p.product_id || p.id) === productId ? result.product : p));
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
        <div style={{ height: 140, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={name || 'product'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
            style={{ flex: 1, padding: '7px 0', fontSize: 11, color: 'var(--fg)', background: 'none', border: 'none', borderRight: '1px solid var(--border)', cursor: 'pointer' }}
          >
            Update Stock
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleNavigate(); }}
            style={{ width: 40, padding: '7px 0', fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="View Details"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
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
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = {
    padding: '7px 10px',
    fontSize: 12,
    color: 'var(--fg)',
    borderBottom: '1px solid var(--border)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

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
            onChange={(e) => setSearchQuery(e.target.value)}
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
          <button
            onClick={() => setIsModalOpen(true)}
            style={{ padding: '5px 14px', fontSize: 12, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}
          >
            + Add Product
          </button>
        </div>
      </div>

      {/* Add Product Modal */}
      {isModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}>
          <div style={{ background: '#fff', width: '90%', maxWidth: 640, padding: 24, position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Add New Product</div>
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--muted)', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setSaving(true);
                let image_url: string | undefined = undefined;
                if (imageFile) {
                  try {
                    const formData = new FormData();
                    formData.append('file', imageFile);
                    formData.append('folder', 'products');
                    const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
                    if (uploadRes.ok) { const uploadData = await uploadRes.json(); image_url = uploadData.url; }
                  } catch (uploadErr) { console.error('Image upload error:', uploadErr); }
                }
                const body: any = {
                  name: productName || undefined,
                  sku: sku || undefined,
                  quantity: quantity === '' ? undefined : Number(quantity),
                  cost: cost === '' ? undefined : Number(cost),
                  low_stock_threshold: lowStockThreshold === '' ? undefined : Number(lowStockThreshold),
                  returnable: returnable === null ? undefined : !!returnable,
                  image_url: image_url ?? undefined,
                };
                try {
                  const res = await fetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                  if (!res.ok) { setSaving(false); return; }
                  const created = await res.json();
                  const newProduct = created.product || created;
                  const newStock = created.stock;
                  setProducts((p) => [{ ...newProduct, stocks: { quantity: newStock?.quantity ?? (quantity === '' ? 0 : Number(quantity)) } }, ...p]);
                  setProductName(''); setSku(''); setQuantity(''); setCost(''); setLowStockThreshold(''); setReturnable(null); setImageFile(null); setImagePreview(null);
                  setIsModalOpen(false);
                } catch (_err) { /* silently ignore */ }
                finally { setSaving(false); }
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Product Name</label>
                  <input required value={productName} onChange={(e) => setProductName(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>SKU / Serial Number</label>
                  <input value={sku} onChange={(e) => setSku(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Initial Quantity</label>
                  <input type="number" min={0} value={quantity as any} onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Cost per Unit</label>
                  <input type="number" step="0.01" min={0} value={cost as any} onChange={(e) => setCost(e.target.value === '' ? '' : Number(e.target.value))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Low Stock Threshold</label>
                  <input type="number" min={0} value={lowStockThreshold as any} onChange={(e) => setLowStockThreshold(e.target.value === '' ? '' : Number(e.target.value))} style={inputStyle} placeholder="Alert when below" />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Product Photo</label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', cursor: 'pointer' }}>
                    Upload image
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setImageFile(f);
                      if (f) { const fr = new FileReader(); fr.onload = () => setImagePreview(typeof fr.result === 'string' ? fr.result : null); fr.readAsDataURL(f); }
                      else { setImagePreview(null); }
                    }} />
                  </label>
                  {imagePreview && <div style={{ marginTop: 8 }}><img src={imagePreview} style={{ height: 64, objectFit: 'contain' }} alt="preview" /></div>}
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Type</label>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                      <input type="radio" name="returnable" checked={returnable === true} onChange={() => setReturnable(true)} /> Returnable
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                      <input type="radio" name="returnable" checked={returnable === false} onChange={() => setReturnable(false)} /> Consumable
                    </label>
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" onClick={() => setIsModalOpen(false)} style={{ padding: '5px 14px', fontSize: 12, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', cursor: 'pointer' }}>Cancel</button>
                <button type="submit" disabled={saving} style={{ padding: '5px 14px', fontSize: 12, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          {filteredProducts.map((product) => (
            <ProductCard key={product.id ?? Math.random()} product={product} />
          ))}
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid var(--border)', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface)' }}>
                <th style={th}>Product Name</th>
                <th style={th}>Code</th>
                <th style={th}>Cost</th>
                <th style={th}>Stock</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product, idx) => {
                const normalized = (() => {
                  if (!product) return {} as any;
                  const singleKey = Object.keys(product).length === 1 ? Object.keys(product)[0] : null;
                  if (singleKey && (singleKey === 'product' || singleKey === 'data' || singleKey === 'row')) return product[singleKey] ?? product;
                  return product;
                })();
                const name = normalized.name || normalized.title || normalized.product_name || normalized.productName || normalized.label || 'Unnamed';
                const code = normalized.product_code ?? normalized.productCode ?? '—';
                const id = normalized.id ?? normalized.product_id ?? idx;
                const cost = normalized.cost ?? normalized.price ?? normalized.unit_cost ?? '—';
                const stock = normalized.stocks?.quantity ?? normalized.stock ?? normalized.quantity ?? 0;
                return (
                  <tr key={id}>
                    <td style={{ ...td, fontWeight: 500 }}>{name}</td>
                    <td style={td}>{code}</td>
                    <td style={td}>{cost}</td>
                    <td style={td}>{stock}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => handleOpenUpdateStock(normalized)} style={{ padding: '3px 10px', fontSize: 11, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', cursor: 'pointer' }}>Update Stock</button>
                        <button onClick={() => { const pid = normalized.product_id ?? normalized.id; if (pid) router.push(`/products/${pid}`); }} style={{ padding: '3px 10px', fontSize: 11, border: '1px solid var(--accent)', background: 'var(--bg)', color: 'var(--accent)', cursor: 'pointer' }}>View</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
