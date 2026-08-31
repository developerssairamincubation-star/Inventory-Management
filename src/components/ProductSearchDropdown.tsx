"use client";
import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * Keyboard-navigable "type to search" product picker.
 *
 * Extracted from the lending page so the Add Products form gets the same
 * behaviour rather than a second, subtly different implementation. Rendered
 * through a portal because both callers sit inside scrollable, overflow-hidden
 * containers that would otherwise clip the list.
 *
 * The caller owns `activeIndex` — it also owns the input, and the arrow keys
 * have to be handled there (the list itself never holds focus). See
 * useProductSearchKeys below, which packages that handling.
 */
export default function ProductSearchDropdown({
  anchorEl,
  open,
  products,
  onSelect,
  activeIndex = 0,
  onHover,
  listId,
  optionIdPrefix,
}: {
  anchorEl: HTMLElement | null;
  open: boolean;
  products: { product_id: string; product_name: string }[];
  onSelect: (product: { product_id: string; product_name: string }) => void;
  /** Option the arrow keys have moved to; highlighted and scrolled into view. */
  activeIndex?: number;
  /** Keeps the mouse and keyboard pointing at the same option. */
  onHover?: (index: number) => void;
  listId?: string;
  optionIdPrefix?: string;
}) {
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // The list scrolls at 180px tall, so arrowing past the fold has to bring the
  // highlighted row with it — otherwise the selection silently walks off
  // screen and the keyboard path is unusable beyond the first few matches.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, products.length]);

  useEffect(() => {
    if (!open || !anchorEl) { setRect(null); return; }
    const update = () => {
      const r = anchorEl.getBoundingClientRect();
      setRect({ top: r.bottom, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, anchorEl]);

  if (!open || !rect || products.length === 0 || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={listRef}
      id={listId}
      role="listbox"
      style={{
        position: "fixed", top: rect.top, left: rect.left, width: rect.width, zIndex: 1000,
        background: "#fff", border: "1px solid var(--border)", maxHeight: 180, overflowY: "auto",
        boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
      }}
    >
      {products.map((product, index) => {
        const active = index === activeIndex;
        return (
          <button
            key={product.product_id}
            id={optionIdPrefix ? `${optionIdPrefix}-${product.product_id}` : undefined}
            type="button"
            role="option"
            aria-selected={active}
            data-active={active}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onHover?.(index)}
            onClick={() => onSelect(product)}
            style={{
              display: "block", width: "100%", padding: "5px 8px", textAlign: "left", fontSize: 11,
              color: active ? "#fff" : "var(--fg)",
              background: active ? "var(--accent)" : "none",
              border: "none", cursor: "pointer",
            }}
          >
            {product.product_name}
          </button>
        );
      })}
    </div>,
    document.body
  );
}

/**
 * The input-side half of the picker: arrow keys, Home/End, Enter, Escape.
 *
 * Returns an onKeyDown handler plus the ARIA attributes that pair the input
 * with the list. Enter is only swallowed when an option is actually
 * highlighted, so a barcode scanner's trailing Enter still reaches the form.
 *
 * Deliberately NOT named use* — it holds no state and calls no hooks, and its
 * callers invoke it once per row inside a .map(), which the Rules of Hooks
 * would forbid for anything that actually were one.
 */
export function productSearchKeys<T>({
  open,
  items,
  activeIndex,
  setActiveIndex,
  onSelect,
  onClose,
  listId,
  optionId,
}: {
  open: boolean;
  items: T[];
  activeIndex: number;
  setActiveIndex: (updater: (i: number) => number) => void;
  onSelect: (item: T) => void;
  onClose: () => void;
  listId: string;
  optionId: (item: T) => string;
}) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(() => 0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(() => items.length - 1);
    } else if (e.key === "Enter") {
      const picked = items[activeIndex];
      if (picked) {
        e.preventDefault();
        onSelect(picked);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const active = open ? items[activeIndex] : undefined;
  return {
    onKeyDown,
    role: "combobox" as const,
    "aria-expanded": open && items.length > 0,
    "aria-controls": listId,
    "aria-activedescendant": active ? optionId(active) : undefined,
    "aria-autocomplete": "list" as const,
  };
}
