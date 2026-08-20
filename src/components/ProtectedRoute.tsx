"use client";

import { useUser } from "@/contexts/UserContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { appUser, loading, unavailable } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    // A degraded backend (503) is not a sign-out. Redirecting on it meant a
    // brief database blip logged out every user; hold the page instead and
    // let the retry succeed.
    if (unavailable) return;
    if (!appUser) {
      router.replace("/login");
    }
  }, [appUser, loading, unavailable, router]);

  if (loading) return null;

  if (unavailable && !appUser) {
    return (
      <div role="status" className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <p className="font-medium text-gray-900">We can&apos;t reach the server</p>
          <p className="mt-1 text-sm text-gray-600">
            This is usually brief. The page will recover on its own — or reload to try again now.
          </p>
        </div>
      </div>
    );
  }

  if (!appUser) return null;

  return <>{children}</>;
}
