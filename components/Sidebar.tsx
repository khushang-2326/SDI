"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavItem } from "@/types/navigation";
import React from "react";

type NavItemWithIcon = NavItem & {
  icon: (props: { className?: string }) => React.ReactNode;
};

const navItems: NavItemWithIcon[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: ({ className }) => (
      <svg className={className} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
        <rect height="9" rx="1" width="7" x="3" y="3" />
        <rect height="5" rx="1" width="7" x="14" y="3" />
        <rect height="9" rx="1" width="7" x="14" y="12" />
        <rect height="5" rx="1" width="7" x="3" y="16" />
      </svg>
    )
  },
  {
    label: "Leads",
    href: "/leads",
    icon: ({ className }) => (
      <svg className={className} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    )
  },
  {
    label: "Websites",
    href: "/websites",
    icon: ({ className }) => (
      <svg className={className} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
        <path d="M2 12h20" />
      </svg>
    )
  },
  {
    label: "Upload Websites",
    href: "/websites/upload",
    icon: ({ className }) => (
      <svg className={className} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" x2="12" y1="3" y2="15" />
      </svg>
    )
  },
  {
    label: "Run Automation",
    href: "/automation",
    icon: ({ className }) => (
      <svg className={className} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
        <polygon points="6 3 20 12 6 21 6 3" />
      </svg>
    )
  },
  {
    label: "Reports",
    href: "/reports",
    icon: ({ className }) => (
      <svg className={className} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" x2="8" y1="13" y2="13" />
        <line x1="16" x2="8" y1="17" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    )
  },
  {
    label: "Analytics",
    href: "/analytics",
    icon: ({ className }) => (
      <svg className={className} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
        <line x1="18" x2="18" y1="20" y2="10" />
        <line x1="12" x2="12" y1="20" y2="4" />
        <line x1="6" x2="6" y1="20" y2="14" />
      </svg>
    )
  },
  {
    label: "Settings",
    href: "/settings",
    icon: ({ className }) => (
      <svg className={className} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    )
  }
];

export function Sidebar({ userName }: { userName: string }) {
  const pathname = usePathname();
  
  const links = (mobile = false) => navItems.map((item) => {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    const Icon = item.icon;

    return (
      <Link
        aria-current={active ? "page" : undefined}
        className={
          mobile
            ? `flex min-w-[72px] flex-1 flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[10px] font-semibold transition ${
                active ? "bg-cyan-400 text-slate-950 shadow-md" : "text-slate-300 hover:text-white"
              }`
            : `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? "bg-white/14 text-white ring-1 ring-white/15 shadow-sm"
                  : "text-slate-300 hover:bg-white/8 hover:text-white"
              }`
        }
        href={item.href}
        key={item.href}
      >
        <span
          className={`flex items-center justify-center rounded-lg transition ${
            mobile ? "h-6 w-6" : "h-7 w-7"
          } ${
            active
              ? "bg-cyan-400 text-slate-950 shadow-sm"
              : "bg-white/8 text-cyan-300 group-hover:bg-white/12 group-hover:text-cyan-200"
          }`}
        >
          <Icon className={mobile ? "h-3.5 w-3.5" : "h-4 w-4"} />
        </span>
        <span className={mobile ? "whitespace-nowrap" : ""}>{item.label}</span>
      </Link>
    );
  });

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 overflow-y-auto border-r border-indigo-900/10 bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 px-4 py-6 text-white shadow-2xl [scrollbar-width:thin] md:block">
        <div className="mb-8">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-cyan-400 text-lg font-black shadow-lg">
            LA
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
            Lead automation
          </p>
          <h2 className="mt-2 text-xl font-bold">Submitter Studio</h2>
        </div>

        <nav className="space-y-1">{links()}</nav>

        <div className="mt-10 rounded-2xl border border-white/10 bg-white/8 p-4">
          <p className="text-xs text-slate-400">Signed in as</p>
          <p className="mt-1 truncate text-sm font-semibold">{userName}</p>
        </div>
      </aside>

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-700 bg-slate-950/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-white shadow-[0_-8px_30px_rgba(15,23,42,0.18)] backdrop-blur-xl md:hidden"
      >
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {links(true)}
        </div>
      </nav>
    </>
  );
}
