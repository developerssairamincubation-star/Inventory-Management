"use client";

import { useUser } from "@/contexts/UserContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { appUser, loading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!appUser) {
      router.replace("/login");
    }
  }, [appUser, loading, router]);

  if (loading) return null;
  if (!appUser) return null;

  return <>{children}</>;
}
