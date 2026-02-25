"use client";

import React from "react";

export default function Navbar() {
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
      >
        Lab Inventory System
      </span>

      <span style={{ fontSize: 11, color: 'var(--muted)' }}>
        System Administrator
      </span>
    </header>
  );
}
