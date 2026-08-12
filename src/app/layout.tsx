import type { Metadata } from "next";
import { ThemeProvider } from "../components/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Confluence Trading Tools",
  description: "Custom trading indicators and dashboards",
  icons: { icon: "/logo.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem('ctt-theme')==='light')document.documentElement.setAttribute('data-theme','light')}catch(e){}\nsetTimeout(function r(){location.reload()},900000);` }} />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
