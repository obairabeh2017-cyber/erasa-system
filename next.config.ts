import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // قاعدة البيانات المدمجة (PGlite) تحمّل ملفات WASM وقت التشغيل؛ تُترك خارج الحزمة
  serverExternalPackages: ["@electric-sql/pglite", "pglite-prisma-adapter"],
  experimental: {
    // يسمح برفع صور/ملفات الإيصالات حتى 4 ميغابايت (حد Vercel لحجم الطلب 4.5 ميغابايت)
    serverActions: { bodySizeLimit: "4.5mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;

