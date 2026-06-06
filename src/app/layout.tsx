import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Confluence Trading Tools",
  description: "Custom trading indicators and dashboards",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-[#0a1120] text-slate-200">
        {children}
      </body>
    </html>
  );
}