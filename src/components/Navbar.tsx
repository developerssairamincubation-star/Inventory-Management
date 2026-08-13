"use client";

import React from "react";
import { useUser } from "@/contexts/UserContext";

export default function Navbar() {
  const { appUser } = useUser();

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        height: 44,
        background: 'var(--bg)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: 'var(--muted)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      />

      {appUser && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'var(--accent, #334155)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 700,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            {appUser.full_name.charAt(0).toUpperCase()}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', lineHeight: 1.2 }}>
              {appUser.full_name}
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.2, textTransform: 'capitalize' }}>
              {appUser.role === 'super_admin' ? 'System Administrator' : 'User'}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
