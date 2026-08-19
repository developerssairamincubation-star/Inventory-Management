"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Catches errors thrown anywhere below the root layout (page/component
// render errors, thrown promises, etc.) that would otherwise crash to
// Next.js's bare default error screen. The underlying stack trace is
// already in the server log via Next.js's own error reporting for
// server-side failures — this also logs client-side for browser devtools.
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Errors caught by a boundary never reach window.onerror, so the Sentry
  // client SDK can't pick them up on its own — they have to be reported here
  // explicitly, or every page/component render crash goes unrecorded.
  useEffect(() => {
    console.error("[error boundary]", error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "var(--bg)", color: "var(--fg)", fontFamily: "var(--font)" }}>
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Something went wrong</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 20, lineHeight: 1.6 }}>
          We hit an unexpected problem loading this page. Please try again — if it keeps happening, contact your administrator.
        </div>
        <button
          onClick={() => reset()}
          style={{ padding: "6px 16px", fontSize: 12, fontWeight: 600, background: "var(--accent)", color: "var(--accent-fg)", border: "none", cursor: "pointer" }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
