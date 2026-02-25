"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Box,
  NotepadText,
  Users,
  UserPen,
  ReceiptIndianRupee,
  User,
} from "lucide-react";
import { LucideIcon } from "lucide-react";

type NavItem = { label: string; href: string; icon: LucideIcon };

const nav: NavItem[] = [
  { label: "Dashboard",          href: "/dashboard", icon: LayoutDashboard      },
  { label: "Product Management", href: "/products",  icon: Box                  },
  { label: "Lending Management", href: "/lending",   icon: NotepadText          },
  { label: "Student Management", href: "/students",  icon: Users                },
  { label: "Staff Management",   href: "/staffs",    icon: UserPen              },
  { label: "Invoice Details",    href: "/billing",   icon: ReceiptIndianRupee   },
  { label: "User Management",    href: "/users",     icon: User                 },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      style={{
        width: 196,
        minWidth: 196,
        height: '100vh',
        overflowY: 'auto',
        background: 'var(--bg)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 0 16px',
      }}
    >
      {/* Logo */}
      <div style={{ padding: '0 20px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--fg)', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
          Lab Inventory
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
          Management System
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 0', marginTop: 4 }}>
        {nav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '7px 20px',
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--accent)' : 'var(--fg)',
                background: active ? '#eff6ff' : 'transparent',
                borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                letterSpacing: '0.01em',
                transition: 'background 0.1s, color 0.1s',
              }}
            >
              <Icon size={14} strokeWidth={active ? 2.5 : 1.75} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
