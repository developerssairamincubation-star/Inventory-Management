import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "var(--bg)", color: "var(--fg)", fontFamily: "var(--font)" }}>
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Page not found</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 20, lineHeight: 1.6 }}>
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </div>
        <Link
          href="/dashboard"
          style={{ padding: "6px 16px", fontSize: 12, fontWeight: 600, background: "var(--accent)", color: "var(--accent-fg)", border: "none", display: "inline-block", textDecoration: "none" }}
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
