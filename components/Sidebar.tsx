"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavItem } from "@/types/navigation";

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard" }, { label: "Leads", href: "/leads" },
  { label: "Websites", href: "/websites" }, { label: "Upload Websites", href: "/websites/upload" },
  { label: "Run Automation", href: "/automation" }, { label: "Reports", href: "/reports" },
  { label: "Analytics", href: "/analytics" }, { label: "Settings", href: "/settings" }
];
const navIcons = ["D", "L", "W", "U", "R", "P", "A", "S"];

export function Sidebar({ userName }: { userName: string }) {
  const pathname = usePathname();
  const links = (mobile = false) => navItems.map((item, index) => {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    return <Link aria-current={active ? "page" : undefined} className={mobile
      ? `flex min-w-[72px] flex-1 flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[10px] font-semibold ${active ? "bg-cyan-400 text-slate-950" : "text-slate-300"}`
      : `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${active ? "bg-white/14 text-white ring-1 ring-white/15" : "text-slate-300 hover:bg-white/8 hover:text-white"}`
    } href={item.href} key={item.href}>
      <span className={`flex items-center justify-center rounded-lg font-black ${mobile ? "h-6 w-6 text-[11px]" : "h-7 w-7 text-sm"} ${active ? "bg-cyan-400 text-slate-950" : "bg-white/8 text-cyan-300"}`}>{navIcons[index]}</span>
      <span className={mobile ? "whitespace-nowrap" : ""}>{item.label}</span>
    </Link>;
  });

  return <>
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 overflow-y-auto border-r border-indigo-900/10 bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 px-4 py-6 text-white shadow-2xl [scrollbar-width:thin] md:block">
      <div className="mb-8"><div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-cyan-400 text-lg font-black shadow-lg">LA</div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Lead automation</p><h2 className="mt-2 text-xl font-bold">Submitter Studio</h2></div>
      <nav className="space-y-1">{links()}</nav>
      <div className="mt-10 rounded-2xl border border-white/10 bg-white/8 p-4"><p className="text-xs text-slate-400">Signed in as</p><p className="mt-1 truncate text-sm font-semibold">{userName}</p></div>
    </aside>
    <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-700 bg-slate-950/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-white shadow-[0_-8px_30px_rgba(15,23,42,0.18)] backdrop-blur-xl md:hidden">
      <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{links(true)}</div>
    </nav>
  </>;
}
