"use client";

import Link from "next/link";

type NavItem = { label: string; href: string; icon?: string };

function Icon({ src, label }: { src?: string; label: string }) {
  if (!src) {
    return <span className="w-6 h-6 bg-slate-100 rounded inline-block" aria-hidden />;
  }

  return (
    <img
      src={src}
      alt={`${label} icon`}
      className="w-6 h-6 rounded flex-shrink-0"
      draggable={false}
    />
  );
}

export default function Sidebar() {
  const nav: NavItem[] = [
    { label: "Dashboard", href: "/dashboard", icon: "/icons/dashboard.svg" },
    { label: "Product Management", href: "/products", icon: "/icons/products.svg" },
    { label: "Lending Management", href: "/lending", icon: "/icons/lending.svg" },
    { label: "Student Management", href: "/students", icon: "/icons/students.svg" },
    { label: "Staff Management", href: "/staffs", icon: "/icons/staffs.svg" },
    
    { label: "Invoice Details", href: "/billing", icon: "/icons/billing.svg" },
    { label: "User Management", href: "/users", icon: "/icons/users.svg" },
  ];

  return (
    <aside className="w-72 bg-white border-r min-h-screen p-6">

      <nav className="space-y-2">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-4 px-4 py-3 rounded hover:bg-slate-50 text-slate-700"
          >
            <Icon src={item.icon} label={item.label} />
            <span className="text-base font-semibold text-slate-800">{item.label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
