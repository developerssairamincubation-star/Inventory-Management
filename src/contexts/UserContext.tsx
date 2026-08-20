"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export type AppUser = {
  user_id: string;
  email: string;
  full_name: string;
  role: "super_admin" | "user";
  domain: { domain_id: string; domain_name: string; room_name: string } | null;
};

type UserContextValue = {
  appUser: AppUser | null;
  loading: boolean;
  /** The server is reachable but degraded (503). Not a sign-out — show a banner, don't redirect. */
  unavailable: boolean;
  refetch: () => Promise<void>;
};

const UserContext = createContext<UserContextValue>({
  appUser: null,
  loading: true,
  unavailable: false,
  refetch: async () => {},
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const fetchAppUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        setAppUser(await res.json());
        setUnavailable(false);
        return;
      }
      // A 503 means "we can't reach the database", not "you are signed out".
      // This used to collapse into the same `setAppUser(null)` as a real 401,
      // so ProtectedRoute redirected to /login — a brief database blip signed
      // out every user in the building.
      if (res.status === 503) {
        setUnavailable(true);
        return;
      }
      setUnavailable(false);
      setAppUser(null);
    } catch {
      // Network failure is likewise not a sign-out; keep whatever user we had.
      setUnavailable(true);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchAppUser();
      setLoading(false);
    })();
  }, [fetchAppUser]);

  return <UserContext.Provider value={{ appUser, loading, unavailable, refetch: fetchAppUser }}>{children}</UserContext.Provider>;
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
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  const method = (init.method || "GET").toUpperCase();

  // Headers are rebuilt on every attempt, not built once up front. They used
  // to be constructed before the request and reused verbatim by the
  // 401-refresh retry — so a request sent with a stale or missing CSRF token
  // was retried with that same stale token and failed a second time, showing
  // the user a spurious error they had to click through.
  const buildHeaders = () => {
    const headers = new Headers(init.headers);
    if (!isFormData && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (method !== "GET" && method !== "HEAD") {
      const csrf = readCsrfCookie();
      if (csrf) headers.set("X-CSRF-Token", csrf);
    }
    return headers;
  };

  const doFetch = async () => {
    try {
      return await fetch(url, { ...init, headers: buildHeaders(), credentials: "include" });
    } catch (err) {
      // A thrown fetch (offline, DNS failure, aborted) previously propagated
      // uncaught out of every one of authFetch's ~40 call sites as whatever
      // cryptic message the browser gives ("Failed to fetch", etc.) — wrap
      // it in a message a caller can actually show a user.
      console.error(`[authFetch] network error for ${url}:`, err);
      throw new Error("Network error — please check your connection and try again.");
    }
  };

  let res = await doFetch();

  // 403 CSRF_FAILED means the csrf cookie and header disagreed — almost
  // always because the cookie was reissued in another tab. A refresh
  // reissues both, and the retry above now picks up the new value.
  if (res.status === 403 && url !== "/api/auth/refresh") {
    const cloned = res.clone();
    const body = await cloned.json().catch(() => null);
    if (body?.error?.code !== "CSRF_FAILED") return res;
  }

  if ((res.status === 401 || res.status === 403) && url !== "/api/auth/refresh") {
    let refreshRes: Response;
    try {
      refreshRes = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
    } catch (err) {
      // Couldn't even attempt the refresh — fall back to the original 401
      // rather than throwing a differently-shaped error from this one path;
      // callers already handle a non-ok response.
      console.error("[authFetch] network error during token refresh:", err);
      return res;
    }
    if (refreshRes.ok) {
      res = await doFetch();
    }
  }

  return res;
}
