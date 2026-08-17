"use client";

import { useEffect } from "react";

// Only triggers if the root layout itself throws (error.tsx can't catch
// that, since it renders inside the layout). Must render its own
// <html>/<body> since it replaces the entire tree — can't rely on
// globals.css's CSS custom properties being loaded, so values are inlined.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[global error boundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "#ffffff", color: "#111111", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" }}>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Something went wrong</div>
          <div style={{ fontSize: 12, color: "#6b6b6b", marginBottom: 20, lineHeight: 1.6 }}>
            The application hit an unexpected problem and couldn&apos;t load. Please try again — if it keeps happening, contact your administrator.
          </div>
          <button
            onClick={() => reset()}
            style={{ padding: "6px 16px", fontSize: 12, fontWeight: 600, background: "#1a56db", color: "#ffffff", border: "none", cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
