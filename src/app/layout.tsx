import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fleet Manager | Operate — Downtime Control",
  description:
    "Command-center dashboard to reduce downtime, shuffle schedules & drivers, track compliance and fuel for your fleet.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#070B14] text-slate-100 antialiased selection:bg-cyan-500/30 selection:text-cyan-50">
        {children}
      </body>
    </html>
  );
}
