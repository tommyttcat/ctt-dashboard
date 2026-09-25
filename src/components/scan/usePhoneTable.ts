'use client';
// components/scan/usePhoneTable.ts — every scanner table on a 360px phone.
//
// The tables are 940px of 19 columns. Below md (768px) they become the six
// columns a reader acts on — TICKER · CNF · CHG% · PRICE · RVOL · STATUS —
// and a tap on a row opens every other column underneath it, labelled. The
// layout itself is CSS in globals.css (`table.scan-table`); this hook only
// supplies what CSS cannot know:
//
//   data-core   on the header cell and every body cell of a core column,
//               matched by HEADER TEXT, so all twelve tables share one rule
//               and a table's own column order does not matter
//   data-label  the header text on every other cell, for the opened row
//   data-open   toggled on a row by a tap (phones only)
//
// Rows whose cell count differs from the header's (the news line under each
// ticker, Multibagger's and Hidden RS's breakdown rows, empty states) keep
// one line: their widest-spanning cell is `full-grow` (it shrinks and the
// headline inside truncates), the small tags beside it are `full` (natural
// width, never squeezed).
// A MutationObserver re-marks cells React adds later (sorting, polling), and
// the attributes are ones React never sets, so a re-render keeps them.
// Desktop is untouched: nothing here has any effect from md up.
//
// A CALLBACK ref, not useRef + useEffect: every table sits inside a card that
// mounts collapsed, so the <table> appears long after the component does. An
// effect that ran at mount found no table and never ran again (measured 25
// Sep 2026: every cell unmarked, so every cell hidden). The callback fires
// whenever the table itself mounts or unmounts.

import { useCallback, useRef } from 'react';

const CORE: Record<string, string> = {
  TICKER: 'ticker', SYMBOL: 'ticker',
  CNF: 'score', SCORE: 'score',
  'CHG%': 'chg',
  PRICE: 'price',
  RVOL: 'rvol',
  STATUS: 'status',
};

const PHONE = '(max-width: 767px)';
const clean = (s: string | null) => (s ?? '').replace(/[↑↓▲▼⇅↕]/g, '').trim().toUpperCase();

export function usePhoneTable() {
  const cleanup = useRef<(() => void) | null>(null);

  return useCallback((table: HTMLTableElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!table) return;

    const mark = () => {
      const head = table.tHead?.rows[table.tHead.rows.length - 1];
      if (!head) return;
      const labels = [...head.cells].map(th => clean(th.textContent));
      const core = new Map<number, string>();
      [...head.cells].forEach((th, i) => {
        const k = CORE[labels[i]];
        if (k && ![...core.values()].includes(k)) { core.set(i, k); th.setAttribute('data-core', k); }
        else th.removeAttribute('data-core');
      });
      for (const body of table.tBodies) {
        for (const tr of body.rows) {
          if (tr.cells.length !== head.cells.length) {
            const widest = [...tr.cells].reduce((a, c) => (c.colSpan > a.colSpan ? c : a), tr.cells[0]);
            for (const td of tr.cells) td.setAttribute('data-core', td === widest ? 'full-grow' : 'full');
            continue;
          }
          [...tr.cells].forEach((td, i) => {
            const k = core.get(i);
            if (k) { td.setAttribute('data-core', k); td.removeAttribute('data-label'); }
            else { td.removeAttribute('data-core'); if (labels[i]) td.setAttribute('data-label', labels[i]); }
          });
        }
      }
    };
    mark();

    // childList only: marking sets attributes, so it cannot retrigger itself.
    const mo = new MutationObserver(mark);
    mo.observe(table, { childList: true, subtree: true });

    const onClick = (e: MouseEvent) => {
      if (!window.matchMedia(PHONE).matches) return;
      const t = e.target as HTMLElement;
      // Links, buttons and the ticker (its tap opens the chart) keep their own job.
      if (t.closest('a,button,input,select,[role="button"],[data-core="ticker"]')) return;
      const tr = t.closest('tbody tr');
      if (!tr || tr.querySelector('[data-core^="full"]')) return;
      tr.toggleAttribute('data-open');
    };
    table.addEventListener('click', onClick);
    cleanup.current = () => { mo.disconnect(); table.removeEventListener('click', onClick); };
  }, []);
}
