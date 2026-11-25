import { redirect } from 'next/navigation';

/* The Confluence page was removed on 25 Nov 2026 to simplify the site: Setups
   Summary on the dashboard already shows which names sit in several scans.
   The confluence scan still runs — the analyst brief, the ledger and the
   confluence email read it. Old links land on the dashboard. */
export default function ConfluencePage() {
  redirect('/dashboard');
}
