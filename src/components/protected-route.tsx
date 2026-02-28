"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function ProtectedRoute({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      if (!firebaseUser) {
        router.replace("/login");
      }
      setUser(firebaseUser);
      setChecked(true);
    });
    return () => unsub();
  }, []);

  // Never render children until auth is confirmed AND user exists.
  // This prevents any flash of protected content.
  if (!checked || !user) return null;
  return <>{children}</>;
}
