"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import {
  LayoutDashboard,
  Box,
  NotepadText,
  Users,
  UserPen,
  ReceiptIndianRupee,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type NavItem = { label: string; href: string; icon: LucideIcon; adminOnly?: boolean };

const nav: NavItem[] = [
  { label: "Dashboard",          href: "/dashboard", icon: LayoutDashboard    },
  { label: "Product Management", href: "/products",  icon: Box                },
  { label: "Lending Management", href: "/lending",   icon: NotepadText        },
  { label: "Student Management", href: "/students",  icon: Users              },
  { label: "Staff Management",   href: "/staffs",    icon: UserPen            },
  { label: "Invoice Details",    href: "/billing",   icon: ReceiptIndianRupee },
  { label: "Admin Settings",     href: "/admin/settings", icon: ShieldCheck, adminOnly: true },
];

const SIDEBAR_BG = '#1E2938';
const HOVER_BG   = '#4A5365';

export default function Sidebar() {
  const pathname  = usePathname();
  const router    = useRouter();
  const { appUser } = useUser();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sidebar-collapsed') === 'true';
  });
  const [hovered, setHovered] = useState<string | null>(null);

  const handleLogout = async () => {
    await signOut(auth);
    router.push("/login");
  };

  const visibleNav = nav.filter(item => !item.adminOnly || appUser?.role === 'super_admin');
  const w = collapsed ? 60 : 210;

  return (
    <div
      style={{
        position: 'relative',
        width: w,
        minWidth: w,
        maxWidth: w,
        flexShrink: 0,
        transition: 'width 0.2s ease, min-width 0.2s ease, max-width 0.2s ease',
        zIndex: 20,
      }}
    >
      <aside
        style={{
          width: '100%',
          height: '100vh',
          overflowY: 'auto',
          overflowX: 'hidden',
          background: SIDEBAR_BG,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: collapsed ? '16px 0' : '16px 18px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            minHeight: 58,
            flexShrink: 0,
          }}
        >
          <Link
            href="/dashboard"
            style={{ display: 'flex', alignItems: 'center', textDecoration: 'none', cursor: 'pointer' }}
            title="Go to Dashboard"
          >
            <Image src="/Logo.svg" alt="Logo" width={42} height={42} style={{ flexShrink: 0 }} />
            {!collapsed && (
              <div style={{ overflow: 'hidden', marginLeft: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#fff', letterSpacing: '-0.01em', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                  Inventory
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 3, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                  Management System
                </div>
              </div>
            )}
          </Link>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, paddingTop: 8 }}>
          {visibleNav.map((item) => {
            const active  = pathname === item.href || pathname.startsWith(item.href + '/');
            const isHover = hovered === item.href;
            const Icon    = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                onMouseEnter={() => setHovered(item.href)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  gap: 11,
                  padding: collapsed ? '11px 0' : '10px 20px',
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  color: '#fff',
                  background: active || isHover ? HOVER_BG : 'transparent',
                  borderLeft: active ? '3px solid rgba(255,255,255,0.85)' : '3px solid transparent',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  transition: 'background 0.12s',
                }}
              >
                <Icon size={18} strokeWidth={active ? 2.5 : 1.8} style={{ flexShrink: 0 }} />
                {!collapsed && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div style={{ paddingBottom: 16, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8 }}>
          <button
            onClick={handleLogout}
            title={collapsed ? 'Logout' : undefined}
            onMouseEnter={() => setHovered('__logout__')}
            onMouseLeave={() => setHovered(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'flex-start',
              gap: 11,
              padding: collapsed ? '11px 0' : '10px 20px',
              width: '100%',
              fontSize: 13,
              fontWeight: 400,
              color: '#fff',
              background: hovered === '__logout__' ? HOVER_BG : 'transparent',
              border: 'none',
              borderLeft: '3px solid transparent',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              transition: 'background 0.12s',
            }}
          >
            <LogOut size={18} strokeWidth={1.8} style={{ flexShrink: 0 }} />
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(prev => {
          const next = !prev;
          localStorage.setItem('sidebar-collapsed', String(next));
          return next;
        })}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        style={{
          position: 'absolute',
          top: 22,
          right: -12,
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: '#334155',
          border: '1.5px solid rgba(255,255,255,0.18)',
          cursor: 'pointer',
          color: 'rgba(255,255,255,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
          zIndex: 30,
          padding: 0,
        }}
      >
        {collapsed ? <ChevronsRight size={13} strokeWidth={2.5} /> : <ChevronsLeft size={13} strokeWidth={2.5} />}
      </button>
    </div>
  );
}
