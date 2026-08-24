'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/scanners', label: 'Scanners' },
  { href: '/analyst', label: 'Briefing' },
  { href: '/confluence', label: 'Confluence' },
] as const;

export default function DashNav() {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-1.5 flex-wrap">
      {LINKS.map(({ href, label }) => {
        const active = path === href;
        return (
          <Link
            key={href}
            href={href}
            className={`px-3.5 py-1.5 rounded-lg text-[13px] font-bold tracking-wide transition-colors shrink-0 ${
              active
                ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/25'
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] border border-transparent'
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
