'use client';

import { usePathname } from 'next/navigation';
import React from 'react';
import Link from 'next/link';

const LINKS: readonly { href: string; label: string; proOnly?: boolean }[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/analyst', label: 'Briefing' },
  { href: '/news', label: 'News' },
  { href: '/confluence', label: 'Confluence', proOnly: true },
  { href: '/track', label: 'Track Record' },
  { href: '/scanners', label: 'Scanners', proOnly: true },
  { href: '/briefs', label: 'Archive' },
];

const PRO_TIERS = new Set(['pro', 'trial_7', 'trial_14', 'trial_30']);

export default function DashNav({ tier = 'pro' }: { tier?: string }) {
  const path = usePathname();
  return (
    /* ONE LINE ON A LAPTOP. Seven links at 13px with px-3.5 no longer fit the
       header, so "Archive" dropped to a second row; tighter type and padding
       fit them across from md up.

       ON A PHONE THEY WRAP. Measured at 375px the row needs 593px, so the
       first attempt let the bar scroll itself — which is the horizontal
       scrolling inside the card that got reported. A nav is the one thing on
       the page that loses nothing by wrapping to a second line, so it wraps,
       and nothing on these pages scrolls sideways any more. */
    <nav className="flex items-center gap-1 flex-wrap md:flex-nowrap min-w-0">
      {LINKS.filter(l => !l.proOnly || PRO_TIERS.has(tier)).map(({ href, label }) => {
        const active = path === href;
        return (
          <Link
            key={href}
            href={href}
            className={`px-2.5 py-1.5 rounded-lg text-[12px] font-bold tracking-wide transition-colors shrink-0 whitespace-nowrap ${
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
