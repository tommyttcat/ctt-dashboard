import type { Metadata } from "next";
import { ThemeProvider } from "../components/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Confluence Trading Tools",
  description: "Custom trading indicators and dashboards",
  icons: { icon: "/logo.svg", apple: "/apple-touch-icon.png" },
  manifest: "/manifest.json",
};

/**
 * Two separate concerns in one pre-paint inline script.
 *
 * The theme read must run on every page before first paint, or a light-mode
 * user gets a dark flash.
 *
 * The 15-minute reload keeps the live dashboard's data from going stale in a
 * tab left open. It is scoped to the tier-gated routes only: the public pages
 * (/briefs and its archive, /pricing, /subscribe, /login) serve immutable or
 * near-static content, so reloading them forever in an open tab bought nothing
 * and cost a request every 15 minutes per open tab — the same shape as the
 * polling that exhausted the KV quota on 12 Aug 2026. It also read as a bounce
 * in analytics on exactly the pages meant to rank.
 */
const REFRESH_ROUTES = /^\/(?:dashboard|analyst|confluence|scanners|admin)(?:\/|$)/;

const THEME_AND_REFRESH = [
  `try{if(localStorage.getItem('ctt-theme')==='light')document.documentElement.setAttribute('data-theme','light')}catch(e){}`,
  `if(location.pathname==='/'||${REFRESH_ROUTES.toString()}.test(location.pathname))setTimeout(function(){location.reload()},900000);`,
].join('\n');

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <script dangerouslySetInnerHTML={{ __html: THEME_AND_REFRESH }} />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
