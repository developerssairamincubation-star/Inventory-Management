"use client";

import { useUser } from "@/contexts/UserContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { firebaseUser, appUser, loading, appUserLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) {
      router.replace("/login");
    }
  }, [firebaseUser, loading, router]);

  if (loading || appUserLoading) return null;
  if (!firebaseUser) return null;

  // User is authenticated in Firebase but not registered in our users table
  if (!appUser) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "var(--bg)",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <p style={{ fontSize: 15, color: "var(--text)", fontWeight: 600 }}>
          Access denied
        </p>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          Your account has not been activated. Please contact the system administrator.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
