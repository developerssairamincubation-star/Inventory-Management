"use client";

import React from "react";

export default function Navbar() {
  return (
    <header className="flex items-center justify-between p-6 bg-white border-b">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-slate-100 rounded flex items-center justify-center font-extrabold text-slate-800">I</div>
        <span className="text-lg font-semibold text-slate-900">Inventory</span>
      </div>

      <div />
    </header>
  );
}
