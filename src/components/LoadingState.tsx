"use client";

import { useEffect, useState } from "react";

// Pixel-grid loader for long-running work (e.g. AI invoice parsing): a 3x3
// grid whose cells pulse in a chevron wavefront driving left-to-right,
// paired with a shimmering label and a live elapsed timer.
const CHEVRON_DELAYS = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3), c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});
const CYCLE_MS = 650;

function useElapsed() {
  const [ds, setDs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setDs((d) => d + 1), 100);
    return () => clearInterval(t);
  }, []);
  const total = ds / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

export default function LoadingState({ label = "Loading" }: { label?: string }) {
  const elapsed = useElapsed();

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10, width: "fit-content" }}>
      <span aria-hidden style={{ display: "grid", gridTemplateColumns: "repeat(3, 4px)", gap: 1.5 }}>
        {CHEVRON_DELAYS.map((delay, i) => (
          <span
            key={i}
            style={{
              width: 4, height: 4, borderRadius: 1, background: "var(--fg)", opacity: 0.15,
              animation: `loadingStatePixel ${CYCLE_MS}ms ease-in-out ${delay}ms infinite`,
            }}
          />
        ))}
      </span>
      <span
        style={{
          fontSize: 13, fontWeight: 500, color: "transparent",
          backgroundImage: "linear-gradient(90deg, var(--muted) 35%, var(--fg) 50%, var(--muted) 65%)",
          backgroundSize: "200% 100%", backgroundClip: "text", WebkitBackgroundClip: "text",
          animation: "loadingStateShimmer 1.4s linear infinite",
        }}
      >
        {label}
      </span>
      <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
        {elapsed}
      </span>
      <style>{`
        @keyframes loadingStatePixel {
          0%, 100% { opacity: 0.15; }
          20% { opacity: 1; }
          40% { opacity: 0.15; }
        }
        @keyframes loadingStateShimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="loadingStatePixel"], [style*="loadingStateShimmer"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
