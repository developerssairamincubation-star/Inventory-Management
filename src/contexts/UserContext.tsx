"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";

export type AppUser = {
  user_id: string;
  email: string;
  full_name: string;
  role: "super_admin" | "user";
};

type UserContextValue = {
  firebaseUser: User | null;
  appUser: AppUser | null;
  loading: boolean;
  appUserLoading: boolean;
  token: string | null;
  refetch: () => Promise<void>;
};

const UserContext = createContext<UserContextValue>({
  firebaseUser: null,
  appUser: null,
  loading: true,
  appUserLoading: false,
  token: null,
  refetch: async () => {},
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [appUserLoading, setAppUserLoading] = useState(false);

  async function fetchAppUser(fbUser: User) {
    setAppUserLoading(true);
    try {
      const idToken = await fbUser.getIdToken();
      setToken(idToken);
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAppUser(data);
      } else {
        setAppUser(null);
      }
    } catch {
      setAppUser(null);
    } finally {
      setAppUserLoading(false);
    }
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setLoading(true);
      setFirebaseUser(fbUser);
      if (fbUser) {
        await fetchAppUser(fbUser);
      } else {
        setAppUser(null);
        setToken(null);
        setAppUserLoading(false);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  async function refetch() {
    if (firebaseUser) {
      await fetchAppUser(firebaseUser);
    }
  }

  return (
    <UserContext.Provider value={{ firebaseUser, appUser, loading, appUserLoading, token, refetch }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}

export function useToken(): string | null {
  return useContext(UserContext).token;
}

// Helper: returns a refreshed token and attaches it to fetch options
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error("Not authenticated");
  const token = await fbUser.getIdToken();

  const headers = new Headers(init.headers);
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;

  if (!isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  headers.set("Authorization", `Bearer ${token}`);

  return fetch(url, {
    ...init,
    headers,
  });
}
