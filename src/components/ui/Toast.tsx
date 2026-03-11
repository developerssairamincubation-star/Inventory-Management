"use client";

import React, { createContext, useContext, useState, useCallback, useRef } from "react";

export type ToastType = "success" | "error" | "warning" | "info";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ConfirmState {
  message: string;
  resolve: (value: boolean) => void;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
  showConfirm: (message: string) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

const COLORS: Record<ToastType, { bg: string; border: string; text: string; icon: string }> = {
  success: { bg: "#f0fdf4", border: "#16a34a", text: "#15803d", icon: "✓" },
  error:   { bg: "#fef2f2", border: "#dc2626", text: "#b91c1c", icon: "✕" },
  warning: { bg: "#fffbeb", border: "#d97706", text: "#b45309", icon: "⚠" },
  info:    { bg: "#eff6ff", border: "#2563eb", text: "#1d4ed8", icon: "ℹ" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const counter = useRef(0);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = ++counter.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const showConfirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirm({ message, resolve });
    });
  }, []);

  const resolveConfirm = (value: boolean) => {
    if (confirm) {
      confirm.resolve(value);
      setConfirm(null);
    }
  };

  const dismissToast = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast, showConfirm }}>
      {children}

      {/* Toast stack */}
      <div
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => {
          const c = COLORS[t.type];
          return (
            <div
              key={t.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: c.bg,
                border: `1px solid ${c.border}`,
                borderLeft: `4px solid ${c.border}`,
                padding: "10px 14px",
                minWidth: 260,
                maxWidth: 380,
                boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                pointerEvents: "all",
                animation: "toastSlideIn 0.22s ease",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 700, color: c.text, flexShrink: 0 }}>{c.icon}</span>
              <span style={{ fontSize: 12, color: c.text, flex: 1, lineHeight: 1.4 }}>{t.message}</span>
              <button
                onClick={() => dismissToast(t.id)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: c.text,
                  fontSize: 14,
                  padding: 0,
                  flexShrink: 0,
                  opacity: 0.6,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* Confirm Dialog */}
      {confirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.45)",
          }}
        >
          <div
            style={{
              background: "#fff",
              border: "1px solid var(--border, #e2e8f0)",
              padding: 24,
              width: 360,
              maxWidth: "90vw",
              boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg, #1e293b)", marginBottom: 8 }}>
              Confirm Action
            </div>
            <div style={{ fontSize: 12, color: "var(--muted, #64748b)", marginBottom: 20, lineHeight: 1.5 }}>
              {confirm.message}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => resolveConfirm(false)}
                style={{
                  padding: "5px 18px",
                  fontSize: 12,
                  border: "1px solid var(--border, #e2e8f0)",
                  background: "#fff",
                  color: "var(--fg, #1e293b)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => resolveConfirm(true)}
                style={{
                  padding: "5px 18px",
                  fontSize: 12,
                  fontWeight: 600,
                  background: "#dc2626",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keyframe for slide-in animation */}
      <style>{`
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateX(40px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
