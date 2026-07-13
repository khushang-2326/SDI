"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavItem } from "@/types/navigation";

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Leads", href: "/leads" },
  { label: "Websites", href: "/websites" },
  { label: "Upload Websites", href: "/websites/upload" },
  { label: "Run Automation", href: "/automation" },
  { label: "Reports", href: "/reports" },
  { label: "Analytics", href: "/analytics" },
  { label: "Settings", href: "/settings" }
];

const navIcons = ["⌂", "◎", "◇", "⇧", "▶", "▤", "⌁", "⚙"];

export function Sidebar({ userName }: { userName: string }) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 overflow-y-auto border-r border-indigo-900/10 bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 px-4 py-6 text-white shadow-2xl [scrollbar-width:thin] md:block">
      <div className="mb-8">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-cyan-400 text-lg font-black shadow-lg shadow-indigo-500/30">
          LA
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
          Lead automation
        </p>
        <h2 className="mt-2 text-xl font-bold text-white">Submitter Studio</h2>
      </div>
      <nav className="space-y-1">
        {navItems.map((item, index) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
          <Link
            className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition duration-200 ${
              active
                ? "bg-white/14 text-white shadow-inner ring-1 ring-white/15"
                : "text-slate-300 hover:translate-x-1 hover:bg-white/8 hover:text-white"
            }`}
            href={item.href}
            key={item.href}
          >
            <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm ${active ? "bg-cyan-400 text-slate-950" : "bg-white/8 text-cyan-300"}`}>
              {navIcons[index]}
            </span>
            {item.label}
          </Link>
          );
        })}
      </nav>
      <div className="mt-10 rounded-2xl border border-white/10 bg-white/8 p-4 backdrop-blur">
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-3/4 rounded-full bg-gradient-to-r from-cyan-400 to-indigo-400" />
        </div>
        <p className="text-xs text-slate-400">Signed in as</p>
        <p className="mt-1 text-sm font-semibold text-white">{userName}</p>
      </div>
    </aside>
  );
}
