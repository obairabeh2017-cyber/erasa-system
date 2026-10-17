import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "شركة ايراسا", template: "%s — شركة ايراسا" },
  description: "شركة ايراسا — نظام إدارة الإنتاج والمخزون والمبيعات",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#173d7d",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar-LY" dir="rtl">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
