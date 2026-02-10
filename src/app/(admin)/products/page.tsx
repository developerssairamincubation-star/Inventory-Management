"use client";

import { useEffect, useState } from "react";

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // form fields
  const [productName, setProductName] = useState('');
  const [sku, setSku] = useState('');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [cost, setCost] = useState<number | ''>('');
  const [lowStockThreshold, setLowStockThreshold] = useState<number | ''>('');
  const [returnable, setReturnable] = useState<boolean | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

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

  if (loading) return <div className="p-6">Loading products...</div>;

  // Filter products based on search query
  const filteredProducts = products.filter((product) => {
    if (!searchQuery) return true;
    
    // normalize product fields
    const normalized = (() => {
      if (!product) return {};
      const singleKey = Object.keys(product).length === 1 ? Object.keys(product)[0] : null;
      if (singleKey && (singleKey === 'product' || singleKey === 'data' || singleKey === 'row')) {
        return product[singleKey] ?? product;
      }
      return product;
    })();

    const name = (
      normalized.name ||
      normalized.title ||
      normalized.product_name ||
      normalized.productName ||
      normalized.pname ||
      normalized.label ||
      ''
    ).toLowerCase();

    return name.includes(searchQuery.toLowerCase());
  });

  const GridIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  );

  const ListIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );

  function ProductCard({ product }: { product: any }) {
    // normalize possible nested shapes
    const normalized = (() => {
      if (!product) return {};
      // If the row is wrapped like { product: { ... } } or { data: { ... } }
      const singleKey = Object.keys(product).length === 1 ? Object.keys(product)[0] : null;
      if (singleKey && (singleKey === 'product' || singleKey === 'data' || singleKey === 'row')) {
        return product[singleKey] ?? product;
      }
      return product;
    })();

    const image =
      normalized.image_url || normalized.image || normalized.photo || normalized.imageUrl || null;

    const name =
      normalized.name ||
      normalized.title ||
      normalized.product_name ||
      normalized.productName ||
      normalized.pname ||
      normalized.label ||
      null;

    const code =
      normalized.product_code ?? normalized.productCode ?? null;

    return (
      <div className="bg-slate-600 rounded-xl p-4 flex flex-col items-center shadow-md hover:shadow-lg transition-transform hover:-translate-y-1">
        <div className="w-full bg-white rounded-md p-3 mb-4 flex items-center justify-center h-40 overflow-hidden">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={name || 'product'} className="max-h-full object-contain" />
          ) : (
            <div className="flex flex-col items-center text-slate-400">
              <svg className="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <div className="text-xs text-slate-500">Image not available</div>
            </div>
          )}
        </div>

        <h3 className="text-white text-center font-semibold text-lg truncate w-full">{name ?? 'Unnamed'}</h3>
        <p className="text-slate-300 text-sm mt-1">{code ?? '—'}</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <h1 className="text-2xl font-bold text-slate-800">Products</h1>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="flex-1 sm:flex-none">
            <input
              placeholder="Search products..."
              className="border rounded-full px-4 py-2 w-full sm:w-80 text-sm text-slate-900"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <button title="Sort" className="hidden sm:inline-flex items-center px-3 py-2 border rounded bg-white text-slate-700">
            Sort
          </button>

          <div className="flex bg-white border rounded-lg p-1">
            <button
              onClick={() => setViewMode("grid")}
              aria-pressed={viewMode === "grid"}
              className={`p-2 rounded ${viewMode === "grid" ? "bg-slate-100 text-slate-800 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
            >
              <GridIcon />
            </button>
            <button
              onClick={() => setViewMode("list")}
              aria-pressed={viewMode === "list"}
              className={`p-2 rounded ${viewMode === "list" ? "bg-slate-100 text-slate-800 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
            >
              <ListIcon />
            </button>
          </div>

          <button className="hidden md:inline-flex items-center px-3 py-2 border rounded bg-white text-slate-700">Filter</button>

          <button onClick={() => setIsModalOpen(true)} className="bg-slate-800 text-white px-4 py-2 rounded">+ Add Product</button>
        </div>
      </div>

      {/* Add Product Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-6 w-[90%] max-w-3xl">
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-xl font-semibold text-slate-800">Add new Product</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-500">✕</button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setSaving(true);

                    // prepare image as data URL if provided (we don't store inline image yet)
                    let image_url: string | undefined = undefined;
                    if (imageFile) {
                      image_url = await new Promise<string | undefined>((resolve) => {
                        const fr = new FileReader();
                        fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : undefined);
                        fr.onerror = () => resolve(undefined);
                        fr.readAsDataURL(imageFile);
                      });
                    }

                const body: any = {
                  name: productName || undefined,
                  sku: sku || undefined,
                  quantity: quantity === '' ? undefined : Number(quantity),
                  cost: cost === '' ? undefined : Number(cost),
                  low_stock_threshold: lowStockThreshold === '' ? undefined : Number(lowStockThreshold),
                  returnable: returnable === null ? undefined : !!returnable,
                };
                // do not send image inline to API yet (storage integration planned later)

                try {
                  const res = await fetch('/api/products', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                  });

                  if (!res.ok) {
                    console.error('Failed to create product', await res.text());
                    setSaving(false);
                    return;
                  }

                  const created = await res.json();
                  // API returns { product, stock }, extract just the product
                  const newProduct = created.product || created;
                  // prepend to list
                  setProducts((p) => [newProduct, ...p]);
                  // reset
                  setProductName(''); setSku(''); setQuantity(''); setCost(''); setLowStockThreshold(''); setReturnable(null); setImageFile(null); setImagePreview(null);
                  setIsModalOpen(false);
                } catch (err) {
                  console.error('Error creating product', err);
                } finally {
                  setSaving(false);
                }
              }}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-900">Product name</label>
                  <input required value={productName} onChange={(e) => setProductName(e.target.value)} className="mt-1 block w-full border rounded px-3 py-2 text-sm text-slate-900" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-900">SKU/ Serial number</label>
                  <input value={sku} onChange={(e) => setSku(e.target.value)} className="mt-1 block w-full border rounded px-3 py-2 text-sm text-slate-900" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-900">Initial quantity</label>
                  <input type="number" min={0} value={quantity as any} onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))} className="mt-1 block w-full border rounded px-3 py-2 text-sm text-slate-900" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-900">Cost per unit</label>
                  <input type="number" step="0.01" min={0} value={cost as any} onChange={(e) => setCost(e.target.value === '' ? '' : Number(e.target.value))} className="mt-1 block w-full border rounded px-3 py-2 text-sm text-slate-900" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-900">Low Stock Threshold</label>
                  <input type="number" min={0} value={lowStockThreshold as any} onChange={(e) => setLowStockThreshold(e.target.value === '' ? '' : Number(e.target.value))} className="mt-1 block w-full border rounded px-3 py-2 text-sm text-slate-900" placeholder="Alert when stock falls below" />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-900">Product Photo</label>
                  <label className="mt-2 inline-flex items-center gap-2 cursor-pointer px-3 py-2 bg-slate-100 rounded">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-slate-800" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7M16 3v4M8 3v4m8 4l-3 3-2-2-4 4" />
                    </svg>
                    <span className="text-sm text-slate-900">Upload product photo</span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setImageFile(f);
                      if (f) {
                        const fr = new FileReader();
                        fr.onload = () => setImagePreview(typeof fr.result === 'string' ? fr.result : null);
                        fr.readAsDataURL(f);
                      } else {
                        setImagePreview(null);
                      }
                    }} />
                  </label>

                  {imagePreview && <div className="mt-3"><img src={imagePreview} className="h-24 object-contain rounded" alt="preview"/></div>}
                </div>

                <div className="md:col-span-2 mt-2">
                  <div className="flex items-center gap-6">
                    <label className="inline-flex items-center gap-2">
                      <input className="accent-slate-800 h-4 w-4" type="radio" name="returnable" checked={returnable === true} onChange={() => setReturnable(true)} />
                      <span className="text-sm text-slate-800">Returnable</span>
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input className="accent-slate-800 h-4 w-4" type="radio" name="returnable" checked={returnable === false} onChange={() => setReturnable(false)} />
                      <span className="text-sm text-slate-800">Consumable</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button type="submit" disabled={saving} className="bg-slate-800 text-white px-4 py-2 rounded">{saving ? 'Saving...' : 'Save changes'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewMode === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {filteredProducts.map((product) => (
            <ProductCard key={product.id ?? Math.random()} product={product} />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded shadow overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product ID</th>
                
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cost</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Available Stock</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredProducts.map((product, idx) => {
                // normalize product fields for table display
                const normalized = (() => {
                  if (!product) return {} as any;
                  const singleKey = Object.keys(product).length === 1 ? Object.keys(product)[0] : null;
                  if (singleKey && (singleKey === 'product' || singleKey === 'data' || singleKey === 'row')) {
                    return product[singleKey] ?? product;
                  }
                  return product;
                })();

                const name = normalized.name || normalized.title || normalized.product_name || normalized.productName || normalized.label || 'Unnamed';
                const code = normalized.product_code ?? normalized.productCode ?? '-';
                const id = normalized.id ?? normalized.product_id ?? idx;
                
                const cost = normalized.cost ?? normalized.price ?? normalized.unit_cost ?? '';
                const stock = normalized.stock ?? normalized.quantity ?? normalized.total_stock ?? normalized.available ?? 0;

                return (
                  <tr key={id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{code}</td>
                    
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{cost}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{stock}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

