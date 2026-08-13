"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export type AppUser = {
  user_id: string;
  email: string;
  full_name: string;
  role: "super_admin" | "user";
};

type UserContextValue = {
  appUser: AppUser | null;
  loading: boolean;
  refetch: () => Promise<void>;
};

const UserContext = createContext<UserContextValue>({
  appUser: null,
  loading: true,
  refetch: async () => {},
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAppUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        setAppUser(await res.json());
      } else {
        setAppUser(null);
      }
    } catch {
      setAppUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchAppUser();
      setLoading(false);
    })();
  }, [fetchAppUser]);

  return <UserContext.Provider value={{ appUser, loading, refetch: fetchAppUser }}>{children}</UserContext.Provider>;
}

export function useUser() {
  return useContext(UserContext);
}

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|; )csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * fetch wrapper for authenticated API calls: sends cookies, attaches the
 * CSRF header on mutating requests, and — since the access token cookie is
 * only 15 minutes and we don't run a client-side refresh timer — silently
 * calls /api/auth/refresh and retries once on a 401 before giving up. This
 * replaces the old Firebase-SDK behavior where getIdToken() transparently
 * refreshed a long-lived session; without equivalent retry logic here,
 * users would see spurious auth failures every 15 minutes.
 */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;

  if (!isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const method = (init.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const csrf = readCsrfCookie();
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }

  const doFetch = () => fetch(url, { ...init, headers, credentials: "include" });

  let res = await doFetch();

  if (res.status === 401 && url !== "/api/auth/refresh") {
    const refreshRes = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
    if (refreshRes.ok) {
      res = await doFetch();
    }
  }

  return res;
}
