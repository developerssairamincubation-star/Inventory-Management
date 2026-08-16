"use client";

// Shared Prev/numbered-pages/Next + Show All/Paginate control, matching the
// visual style previously copy-pasted independently across the products,
// lending, and billing pages.

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  showAll: boolean;
  onToggleShowAll: (showAll: boolean) => void;
}

export default function Pagination({ page, totalPages, onPageChange, showAll, onToggleShowAll }: PaginationProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button
        onClick={() => onToggleShowAll(!showAll)}
        style={{
          padding: "4px 10px",
          fontSize: 11,
          background: showAll ? "var(--accent)" : "var(--bg)",
          color: showAll ? "#fff" : "var(--fg)",
          border: "1px solid var(--border)",
          cursor: "pointer",
        }}
      >
        {showAll ? "Paginate" : "Show All"}
      </button>
      {!showAll && totalPages > 1 && (
        <>
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
            style={{
              padding: "4px 8px",
              fontSize: 11,
              background: "var(--bg)",
              color: "var(--fg)",
              border: "1px solid var(--border)",
              cursor: page === 1 ? "not-allowed" : "pointer",
              opacity: page === 1 ? 0.5 : 1,
            }}
          >
            Prev
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              style={{
                padding: "4px 8px",
                fontSize: 11,
                background: page === p ? "var(--accent)" : "var(--bg)",
                color: page === p ? "#fff" : "var(--fg)",
                border: "1px solid var(--border)",
                cursor: "pointer",
                fontWeight: page === p ? 600 : 400,
              }}
            >
              {p}
            </button>
          ))}
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page === totalPages}
            style={{
              padding: "4px 8px",
              fontSize: 11,
              background: "var(--bg)",
              color: "var(--fg)",
              border: "1px solid var(--border)",
              cursor: page === totalPages ? "not-allowed" : "pointer",
              opacity: page === totalPages ? 0.5 : 1,
            }}
          >
            Next
          </button>
        </>
      )}
    </div>
  );
}
