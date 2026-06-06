'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function AutoRefresh({ interval = 30000 }: { interval?: number }) {
  const router = useRouter();

  useEffect(() => {
    // router.refresh() tells Next.js to re-run the server components 
    // and stream the fresh HTML down without flashing or reloading the page
    const timer = setInterval(() => {
      router.refresh();
    }, interval);

    return () => clearInterval(timer);
  }, [router, interval]);

  return null; 
}