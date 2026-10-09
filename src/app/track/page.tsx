import { redirect } from 'next/navigation';

/* The Track Record page was removed on 9 Oct 2026 at the owner's request:
   the record showed the published picks and Model Books losing money, and
   the site no longer publishes picks. Old links land on the dashboard. */
export default function TrackPage() {
  redirect('/dashboard');
}
