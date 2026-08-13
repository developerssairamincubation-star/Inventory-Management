"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { LockKeyhole, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!token) {
      showToast("This reset link is missing its token.", "error");
      return;
    }
    if (password.length < 8) {
      showToast("Password must be at least 8 characters.", "error");
      return;
    }
    if (password !== confirmPassword) {
      showToast("Passwords do not match.", "error");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message || "Failed to reset password.");
      }
      showToast("Password reset. Please log in with your new password.", "success");
      router.push("/login");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to reset password.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") submit();
  };

  return (
    <div className="flex bg-[#F1F7FF] h-screen">
      <div className="w-[50%] flex items-center">
        <div className="w-[400px] flex flex-col ml-[120px]">
          <div className="flex items-center gap-3 mb-4">
            <img
              src="/Logo.svg"
              alt="Logo"
              className="w-[48px] h-[48px]"
              style={{ filter: "invert(29%) sepia(56%) saturate(800%) hue-rotate(200deg) brightness(80%) contrast(95%)" }}
            />
            <span className="text-[23px] font-semibold text-[#3759C1] leading-tight">Inventory Management System</span>
          </div>

          <h1 className="text-[19px] text-[#0E1323] mb-[40px] font-semibold">Reset your password</h1>

          <div className="relative w-full mb-0">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3759C1] pointer-events-none">
              <LockKeyhole size={16} />
            </span>
            <input
              className="bg-[#F1F7FF] border border-[#3759C1] border-[1px] shadow-[0_0_10px_rgba(55,89,193,0.25)] pl-9 pr-10 py-2 w-full h-[40px] rounded-md text-[#0E1323]"
              type={showPassword ? "text" : "password"}
              placeholder="New password"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#3759C1] cursor-pointer"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <div className="relative w-full mt-[20px] mb-[50px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3759C1] pointer-events-none">
              <LockKeyhole size={16} />
            </span>
            <input
              className="bg-[#F1F7FF] border border-[#3759C1] border-[1px] shadow-[0_0_10px_rgba(55,89,193,0.25)] pl-9 pr-4 py-2 w-full h-[40px] rounded-md text-[#0E1323]"
              type={showPassword ? "text" : "password"}
              placeholder="Confirm new password"
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>

          <button
            onClick={submit}
            disabled={submitting}
            className="bg-[#1D2937] text-[#F1F7FF] font-normal text-[16px] w-full h-[40px] rounded-[10px] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? "Resetting..." : "Reset password"}
          </button>
        </div>
      </div>
      <div className="w-[50%] bg-[#fff] pb-[50px] flex items-center justify-center">
        <img src="/images/Inventroy-img.jpg" alt="Reset password background" className="object-cover" />
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
